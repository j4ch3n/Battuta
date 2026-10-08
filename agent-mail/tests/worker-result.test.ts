import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import extension from "../index.ts";
import { envelope, StoredMessage, validate, sendRequest, replyRequest } from "../schemas.ts";
import { content, requestContent, completedContent } from "./fixtures.ts";
import {
  formatWorkerResult,
  type TaskRow,
  type TerminalReport,
} from "../../supabase/functions/_shared/task-contracts.ts";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<object>()),
  createClient: sdk.create,
}));
const ref = { conversation_id: "12345678-1234-4234-8234-123456789abc", id: "abcdef123456" };
const workerContent = {
  schema_version: 1,
  kind: "worker_result",
  state: "completed",
  text: "Battuta — Fix parser\nTests pass",
  references: [{ locator: "parser.test.ts", note: "Tests pass" }],
};
const workerRow = {
  ...ref,
  sender: "worker.host-1",
  recipient: "pm",
  message_type: "chat",
  content: workerContent,
  status: "created",
  in_reply_to: null,
  response_due: null,
  created_at: "2026-10-07T00:00:00Z",
  read_at: null,
  replied_at: null,
};
type Delivery = { customType: string; content: string; details: { message_ref: typeof ref } };
type Handler = (event: unknown, context: ExtensionContext) => Promise<unknown>;
type Tool = {
  name: string;
  execute(
    id: string,
    args: unknown,
    signal: undefined,
    update: undefined,
    ctx: ExtensionContext,
  ): Promise<unknown>;
};
function harness(
  rows: Record<string, unknown>[] = [{ ...workerRow }],
  historical: Delivery[] = [],
) {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, Tool>();
  const messages: Delivery[] = [];
  const entries: unknown[] = historical.map((d) => ({ type: "custom_message", ...d }));
  const notify = vi.fn();
  const ctx = {
    sessionManager: { getSessionId: () => ref.conversation_id, getBranch: () => entries },
    ui: { notify },
  } as unknown as ExtensionContext;
  const invoke = vi
    .fn<(name: string, options: { body: Record<string, unknown> }) => Promise<unknown>>()
    .mockImplementation((_name: string, options: { body: Record<string, unknown> }) => {
      if (options.body.operation === "read") {
        const r = options.body.message_ref as typeof ref;
        const row = rows.find((row) => row.id === r.id)!;
        row.status = "read";
        return Promise.resolve({ data: { data: row, error: null }, error: null });
      }
      const parent = rows.find((row) => row.id === (options.body.parent as typeof ref)?.id);
      if (parent) parent.status = "replied";
      return Promise.resolve({
        data: {
          data: {
            ...workerRow,
            id: "111111111111",
            sender: "pm",
            recipient: "tl",
            content: options.body.content,
          },
          error: null,
        },
        error: null,
      });
    });
  let wake!: () => void;
  const removeChannel = vi.fn().mockResolvedValue(undefined);
  sdk.create.mockReturnValue({
    functions: { invoke },
    removeChannel,
    channel: () => {
      const channel = {
        on: (_name: string, _filter: unknown, callback: () => void) => {
          wake = callback;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    from: () => {
      const filters = new Map<string, unknown>();
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.set(key, value);
          return query;
        },
        or: () => query,
        order: () => query,
        range: (start: number, end: number) =>
          Promise.resolve({
            data: rows
              .filter(
                (row) =>
                  row.recipient === "pm" &&
                  (row.status === "created" ||
                    (row.status === "read" && row.response_due !== null)),
              )
              .slice(start, end + 1),
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: rows.find((row) => [...filters].every(([key, value]) => row[key] === value)),
            error: null,
          }),
      };
      return query;
    },
  });
  extension({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    sendMessage: (message: Delivery) => {
      messages.push(message);
    },
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI);
  const call = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
  return {
    rows,
    messages,
    invoke,
    removeChannel,
    notify,
    start: () => call("session_start"),
    stop: () => call("session_shutdown"),
    accept: async (message = messages[0]) => {
      entries.push({ type: "custom_message", ...message });
      await call("message_start", { message: { role: "custom", ...message } });
    },
    settle: () => call("agent_before_settle", { outcome: "completed" }),
    wake: () => wake(),
    execute: (name: string, args: unknown) =>
      tools.get(name)!.execute("call", args, undefined, undefined, ctx),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AGENT_ROLE", "pm");
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["completed", "failed"])(
  "accepts receive-only %s result with ordinary mail reference and no execution correlations",
  (state) => {
    const row = validate(StoredMessage, { ...workerRow, content: { ...workerContent, state } });
    const rendered = envelope(row);
    expect(rendered.message_ref).toEqual(ref);
    expect(rendered.content).toEqual({ ...workerContent, state });
    expect(JSON.stringify(rendered)).not.toMatch(/task_id|opencode_session|claimed_by/);
  },
);
it.each([
  { sender: "pm" },
  { sender: "worker." },
  { sender: "worker.bad/host" },
  { recipient: "worker.host" },
  { response_due: "2026-10-07T00:10:00Z" },
  { in_reply_to: "123456abcdef" },
  { content: { ...workerContent, task_id: "private" } },
  { content: { ...workerContent, text: " " } },
  { content: { ...workerContent, references: [{ locator: "x", description: "wrong shape" }] } },
])("rejects malformed or reply-expecting worker mail %j", (patch) => {
  expect(() => envelope(validate(StoredMessage, { ...workerRow, ...patch }))).toThrow();
});
it("preserves bot-only send/reply schemas", () => {
  const intent = { message_type: "chat", content: workerContent, reply_expectation: null };
  expect(() =>
    sendRequest({ role: "pm", sessionId: ref.conversation_id }, { recipient: "tl", ...intent }),
  ).toThrow();
  expect(() =>
    replyRequest({ role: "pm", sessionId: ref.conversation_id }, { parent: ref, ...intent }),
  ).toThrow();
});
it("delivers worker mail then acknowledges only Pi acceptance, without reply obligations", async () => {
  const h = harness();
  await h.start();
  expect(h.messages).toHaveLength(1);
  expect(h.rows[0]?.status).toBe("created");
  expect(h.invoke).not.toHaveBeenCalled();
  expect(JSON.parse(h.messages[0].content)).toMatchObject({
    content: workerContent,
    message_ref: ref,
  });
  await h.accept();
  expect(h.invoke.mock.calls[0]?.[1].body).toEqual({
    operation: "read",
    recipient_role: "pm",
    message_ref: ref,
  });
  expect(h.rows[0]?.status).toBe("read");
  expect(await h.settle()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.messages).toHaveLength(1);
  await h.stop();
  expect(h.removeChannel).toHaveBeenCalledOnce();
});
it("retries read acknowledgement without redelivery after transient write uncertainty", async () => {
  const h = harness();
  await h.start();
  h.invoke.mockRejectedValueOnce(new Error("offline"));
  await h.accept();
  expect(h.rows[0]?.status).toBe("created");
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.rows[0]?.status).toBe("read");
  expect(h.messages).toHaveLength(1);
  await h.stop();
});
it("acknowledges historical worker delivery without replay", async () => {
  const h = harness(
    [{ ...workerRow }],
    [{ customType: "agent-mail", content: "prior delivery", details: { message_ref: ref } }],
  );
  await h.start();
  expect(h.messages).toHaveLength(0);
  expect(h.rows[0]?.status).toBe("read");
  await h.stop();
});
it("rejects invalid worker metadata at reception before Pi delivery", async () => {
  const h = harness([{ ...workerRow, response_due: "2026-10-07T00:10:00Z" }]);
  await h.start();
  expect(h.messages).toHaveLength(0);
  expect(h.invoke).not.toHaveBeenCalled();
  await h.stop();
});
it("does not let invalid worker routing starve ordinary PM/TL mail", async () => {
  const h = harness([
    { ...workerRow, response_due: "2026-10-07T00:10:00Z" },
    { ...workerRow, id: "222222222222", sender: "tl", content: content("Ordinary update") },
  ]);
  await h.start();
  expect(h.messages).toHaveLength(1);
  expect(JSON.parse(h.messages[0].content)).toMatchObject({
    sender: "tl",
    content: { summary: "Ordinary update" },
  });
  await h.accept();
  expect(h.rows[1].status).toBe("read");
  expect(h.rows[0].status).toBe("created");
  await h.stop();
});
it.each(
  [
    { ...workerContent, task_id: "private" },
    { ...workerContent, text: " " },
    { ...workerContent, references: [{ locator: "x", description: "wrong shape" }] },
  ].flatMap((content) => [0, 20].map((offset) => ({ content, offset }))),
)(
  "skips malformed worker content $content at offset $offset without starvation or acknowledgement",
  async ({ content: invalidContent, offset }) => {
    const rows: Record<string, unknown>[] = Array.from({ length: 23 }, (_, index) => ({
      ...workerRow,
      id: (index + 1).toString(16).padStart(12, "0"),
      ...(index % 2 === 0 ? { sender: "tl", content: content("Ordinary update") } : {}),
    }));
    rows[offset] = { ...rows[offset], sender: workerRow.sender, content: invalidContent };
    const invalid = structuredClone(rows[offset]);
    const h = harness(rows);
    await h.start();
    expect(h.messages).toHaveLength(22);
    expect(h.messages.some((message) => message.details.message_ref.id === invalid.id)).toBe(false);
    expect(h.messages.some((message) => message.details.message_ref.id === rows[22].id)).toBe(true);
    for (const message of h.messages) await h.accept(message);
    expect(h.invoke.mock.calls).toHaveLength(22);
    expect(
      h.invoke.mock.calls.some(
        ([, options]) => (options.body.message_ref as typeof ref).id === invalid.id,
      ),
    ).toBe(false);
    expect(rows[offset]).toEqual(invalid);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid worker result"));
    await h.stop();
  },
);
it("keeps ordinary malformed content strict rather than silently skipping it", async () => {
  const h = harness([
    { ...workerRow },
    {
      ...workerRow,
      id: "222222222222",
      sender: "tl",
      content: { ...content("Update"), extra: true },
    },
  ]);
  await h.start();
  expect(h.messages).toEqual([]);
  expect(h.invoke).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Reconciliation failed"));
  await h.stop();
});
it("retains ordinary request obligations, exact coverage, and stored replies", async () => {
  const h = harness([
    {
      ...workerRow,
      sender: "tl",
      content: requestContent("Check parser", ["Parser passes"]),
      response_due: "2026-10-07T00:10:00Z",
    },
  ]);
  await h.start();
  await h.accept();
  expect(await h.settle()).toMatchObject({ continue: true });
  const args = {
    parent: ref,
    message_type: "chat",
    content: completedContent("Done", ["Other check"]),
    reply_expectation: null,
  };
  await expect(h.execute("reply_agent_message", args)).rejects.toThrow(/cover.*exactly/);
  await h.execute("reply_agent_message", {
    ...args,
    content: completedContent("Done", ["Parser passes"]),
  });
  expect(h.rows[0]?.status).toBe("replied");
  expect(await h.settle()).toBeUndefined();
  await h.stop();
});
it("does not allow bot replies or related results to target worker mail", async () => {
  const h = harness();
  await h.start();
  await h.accept();
  const intent = { message_type: "chat", content: content("Thanks"), reply_expectation: null };
  await expect(h.execute("reply_agent_message", { parent: ref, ...intent })).rejects.toThrow(
    /worker|PM\/TL/,
  );
  await expect(
    h.execute("send_agent_message", {
      recipient: "tl",
      ...intent,
      content: content("Result", { related_messages: [ref] }),
    }),
  ).rejects.toThrow();
  await h.stop();
});
it("bounds received worker content bytes independently of character limits", () => {
  const oversized = {
    ...workerContent,
    references: Array.from({ length: 20 }, () => ({ locator: "tests", note: "界".repeat(3000) })),
  };
  expect(() => envelope(validate(StoredMessage, { ...workerRow, content: oversized }))).toThrow(
    /bytes/,
  );
});
it("accepts shared worker results when task context pushes a valid report past ordinary mail's byte limit", () => {
  const task: TaskRow = {
    id: ref.conversation_id,
    key: "large-report",
    project: "Battuta",
    ticket_id: null,
    delegator_role: "pm",
    created_at: workerRow.created_at,
    claimed_by: "host-1",
    claimed_at: workerRow.created_at,
    opencode_session_id: null,
    terminal_report: null,
    finished_at: null,
    result_message_ref: null,
    instruction: {
      schema_version: 1,
      summary: "界".repeat(2000),
      objective: "Check parser",
      scope: ["Parser"],
      constraints: [],
      inputs: [],
      acceptance_criteria: [{ id: "c1", expectation: "Tests pass" }],
      deliverables: ["Tests"],
    },
  };
  const report: TerminalReport = {
    schema_version: 1,
    state: "failed",
    summary: "Build failed",
    checks: [],
    failure: "Build failed",
    artifacts: Array.from({ length: 10 }, () => ({
      locator: "x".repeat(2000),
      description: "n".repeat(3990),
    })),
  };
  const formatted = formatWorkerResult(task, report);
  expect(new TextEncoder().encode(JSON.stringify(formatted)).length).toBeGreaterThan(65536);
  expect(envelope(validate(StoredMessage, { ...workerRow, content: formatted })).content).toEqual(
    formatted,
  );
});
it("bounds ordinary unanswered request corrections and reports the unresolved obligation", async () => {
  const h = harness([
    {
      ...workerRow,
      sender: "tl",
      content: requestContent("Check parser"),
      response_due: "2026-10-07T00:10:00Z",
    },
  ]);
  await h.start();
  await h.accept();
  expect(await h.settle()).toMatchObject({ continue: true });
  expect(await h.settle()).toMatchObject({ continue: true });
  expect(await h.settle()).toBeUndefined();
  expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/two correction turns/), "error");
  await h.stop();
});
it("does not replay an uncertain ordinary reply and reconciles required reply status", async () => {
  const h = harness([
    {
      ...workerRow,
      sender: "tl",
      content: requestContent("Check parser"),
      response_due: "2026-10-07T00:10:00Z",
    },
  ]);
  await h.start();
  await h.accept();
  h.invoke.mockRejectedValueOnce(new Error("offline"));
  const args = {
    parent: ref,
    message_type: "chat",
    content: content("Progress"),
    reply_expectation: null,
  };
  await expect(h.execute("reply_agent_message", args)).rejects.toThrow(/offline/);
  await expect(h.execute("reply_agent_message", args)).rejects.toThrow(/uncertain/);
  expect(await h.settle()).toBeUndefined();
  expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/uncertain/), "error");
  h.rows[0].status = "replied";
  expect(await h.settle()).toBeUndefined();
  await h.stop();
});
