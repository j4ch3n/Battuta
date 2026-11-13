import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildManagerContent, createNotifier } from "../notify.ts";
import { Content, validate } from "../../agent-mail/schemas.ts";
import { validateContent, MAX_CONTENT_BYTES } from "../../agent-mail/content.ts";
import { detail } from "./fixtures.ts";
import type { Detail } from "../types.ts";

function finished(blocked = false): Detail {
  const d = detail();
  d.assignment.status = blocked ? "blocked" : "done";
  d.assignment.ready = false;
  d.assignment.claimed_at = d.assignment.created_at;
  d.assignment.lease_expired_at = "2026-11-04T12:45:00.000001Z";
  d.assignment.closed_at = blocked ? null : d.assignment.updated_at;
  d.assignment.blocker = blocked ? "Missing input" : null;
  d.todos[0].status = blocked ? "blocked" : "done";
  d.todos[0].outcome = blocked ? "Investigated" : "Implemented";
  d.todos[0].blocker = d.assignment.blocker;
  d.todos[0].evidence = ["tests/proof.ts"];
  return d;
}
const conversationId = "11111111-1111-4111-8111-111111111111";
test.each(["empty", "unfinished", "cancelled"])(
  "completion ledger check handles %s plans honestly",
  (state) => {
    const d = finished();
    if (state === "empty") d.todos = [];
    else d.todos[0].status = state === "unfinished" ? "todo" : "cancelled";
    if (state !== "cancelled") expect(() => buildManagerContent(d)).toThrow();
    else {
      const content = buildManagerContent(d);
      expect(() => validateContent(content)).not.toThrow();
      expect(content.result?.accomplished.join(" ")).toContain("no completed implementation");
    }
  },
);
function sender(mode: "sent" | "failed" | "uncertain" = "sent") {
  const sequence: string[] = [];
  const entries: unknown[] = [];
  const invoke = vi.fn((_name: string, { body }: { body: Record<string, unknown> }) => {
    sequence.push("send");
    if (mode !== "sent")
      return Promise.resolve({
        data: null,
        error: {
          context: Response.json(
            { error: "Unavailable" },
            { status: mode === "failed" ? 400 : 503 },
          ),
        },
      });
    return Promise.resolve({
      data: {
        data: {
          conversation_id: conversationId,
          id: "123456abcdef",
          sender: "worker",
          recipient: "manager",
          message_type: "chat",
          content: body.content,
          status: "created",
          in_reply_to: null,
          response_due: null,
          created_at: "2026-11-04T12:00:00Z",
          read_at: null,
          replied_at: null,
        },
      },
      error: null,
    });
  });
  const notify = createNotifier({
    client: { functions: { invoke } } as unknown as SupabaseClient,
    conversationId,
    appendEntry: (_kind, data) => {
      entries.push(data);
      sequence.push("entry");
    },
  });
  return { notify, invoke, sequence, entries };
}

test.each([false, true])("builds truthful bounded outcome content (blocked=%s)", (blocked) => {
  const d = finished(blocked),
    content = buildManagerContent(d);
  expect(() => validate(Content, content)).not.toThrow();
  expect(() => validateContent(content)).not.toThrow();
  expect(content.result?.state).toBe(blocked ? "blocked" : "complete");
  if (blocked) expect(content.result?.checks).toEqual([]);
  else {
    expect(content.result?.checks).toHaveLength(1);
    expect(content.result?.checks[0]).toMatchObject({
      required: true,
      result: "passed",
      evidence: [{ locator: `assignment:${d.assignment.id}` }],
    });
  }
  expect(content.result?.remaining.length).toBe(blocked ? 2 : 0);
  expect(content.references.some((ref) => ref.locator === "tests/proof.ts")).toBe(true);
  expect(content.context.join(" ")).toContain(d.assignment.id);
  expect(content.context.join(" ")).toContain("atlas");
  expect(content.request).toBeNull();
});

test("large/control/unicode evidence stays within mail limits without inventing truncated locators", () => {
  const d = finished(true);
  d.assignment.goal = "😀\u0001".repeat(5000);
  d.assignment.blocker = "Missing authority " + "\u0001".repeat(5000);
  d.todos = Array.from({ length: 1001 }, (_, i) => ({
    ...d.todos[0],
    position: i + 1,
    status: i % 2 ? "done" : "blocked",
    outcome: "Evidence " + "\u0001".repeat(5000),
    evidence: ["https://real.invalid/" + "\u0001".repeat(1000), "/actual/" + "😀".repeat(5000)],
  }));
  const content = buildManagerContent(d);
  expect(() => validate(Content, content)).not.toThrow();
  expect(() => validateContent(content)).not.toThrow();
  expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
  for (const ref of content.references)
    expect(
      ref.locator.startsWith("assignment:") ||
        d.todos.some((todo) => todo.evidence.includes(ref.locator)),
    ).toBe(true);
  expect(content.context.join(" ")).toMatch(/full|omitted|summari/i);
});

test("intent precedes sending and duplicate/concurrent callbacks return one reference", async () => {
  const h = sender(),
    d = finished();
  const results = await Promise.all([h.notify(d), h.notify(d)]);
  expect(results).toEqual([
    { state: "sent", reference: { conversation_id: conversationId, id: "123456abcdef" } },
    { state: "sent", reference: { conversation_id: conversationId, id: "123456abcdef" } },
  ]);
  expect(await h.notify(d)).toEqual(results[0]);
  expect(h.invoke).toHaveBeenCalledTimes(1);
  expect(h.sequence).toEqual(["entry", "send", "entry"]);
  expect(d.assignment.status).toBe("done");
});

test.each(["failed", "uncertain"] as const)(
  "%s send records diagnostics and is not blindly retried",
  async (state) => {
    const h = sender(state),
      d = finished();
    expect((await h.notify(d)).state).toBe(state);
    expect((await h.notify(d)).state).toBe(state);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.entries).toHaveLength(2);
    expect(d.assignment.status).toBe("done");
  },
);

test("a notifier cannot accidentally reuse another assignment's sent reference", async () => {
  const h = sender(),
    d = finished();
  await h.notify(d);
  const other = finished();
  other.assignment.id = "ffffffff";
  expect((await h.notify(other)).state).toBe("failed");
  expect(h.invoke).toHaveBeenCalledTimes(1);
});

test("unsaved intent prevents sending, while an unsaved receipt never triggers resend", async () => {
  for (const failAt of [1, 2]) {
    const h = sender();
    let entries = 0;
    const notify = createNotifier({
      client: { functions: { invoke: h.invoke } } as unknown as SupabaseClient,
      conversationId,
      appendEntry: () => {
        if (++entries === failAt) throw new Error("Disk full");
      },
    });
    const result = await notify(finished());
    expect(result.state).toBe(failAt === 1 ? "failed" : "uncertain");
    expect(await notify(finished())).toEqual(result);
    expect(h.invoke).toHaveBeenCalledTimes(failAt === 1 ? 0 : 1);
  }
});
