import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import extension from "../index.ts";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<object>()),
  createClient: sdk.create,
}));
const input = {
  key: "private-key",
  project: "Battuta",
  ticket_id: "FIS-40",
  instruction: {
    schema_version: 1,
    summary: "Fix parser",
    objective: "Parse safely",
    scope: ["Parser"],
    constraints: [],
    inputs: [],
    acceptance_criteria: [{ id: "c1", expectation: "Tests pass" }],
    deliverables: ["Tests"],
  },
};
const row = {
  id: "12345678-1234-4234-8234-123456789abc",
  ...input,
  delegator_role: "pm",
  created_at: "2026-10-07T00:00:00Z",
  claimed_by: null,
  claimed_at: null,
  opencode_session_id: null,
  terminal_report: null,
  finished_at: null,
  result_message_ref: null,
};
type Tool = {
  name: string;
  execute(
    id: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<{
    content: { type: string; text: string }[];
    details: unknown;
  }>;
};
function harness() {
  const handlers = new Map<string, () => Promise<void>>();
  let tool: Tool | undefined;
  extension({
    on: (name: string, handler: () => Promise<void>) => handlers.set(name, handler),
    registerTool: (value: Tool) => {
      tool = value;
    },
  } as unknown as ExtensionAPI);
  expect(tool, "delegate_task must be registered without task credentials").toBeDefined();
  return {
    execute: (args: unknown = input, signal?: AbortSignal) => tool!.execute("call", args, signal),
    stop: () => handlers.get("session_shutdown")!(),
  };
}
function connection(role = "pm") {
  const invoke = vi
    .fn<
      (
        name: string,
        options: { body: unknown; signal: AbortSignal },
      ) => Promise<{ data: unknown; error: unknown }>
    >()
    .mockResolvedValue({ data: { ...row, delegator_role: role }, error: null });
  const stopAutoRefresh = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const signIn = vi
    .fn()
    .mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  sdk.create.mockReturnValue({
    functions: { invoke },
    auth: {
      signInWithPassword: signIn,
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            app_metadata: {
              battuta: {
                role,
                projects: ["Battuta"],
                ...(role === "worker" ? { worker_id: "host" } : {}),
              },
            },
          },
        },
        error: null,
      }),
      stopAutoRefresh,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined), disconnect },
  });
  return { invoke, stopAutoRefresh, disconnect, signIn };
}
beforeEach(() => {
  vi.stubEnv("AGENT_ROLE", "pm");
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public");
  for (const prefix of ["PM", "TL"]) {
    vi.stubEnv(`${prefix}_TASK_EMAIL`, `${prefix}@example.test`);
    vi.stubEnv(`${prefix}_TASK_PASSWORD`, "secret");
  }
  sdk.create.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it.each(["pm", "tl"])(
  "lazily delegates as verified %s and acknowledges a durable offline queue",
  async (role) => {
    vi.stubEnv("AGENT_ROLE", role);
    const c = connection(role);
    const h = harness();
    expect(sdk.create).not.toHaveBeenCalled();
    const result = await h.execute();
    expect(c.signIn).toHaveBeenCalledWith({
      email: `${role.toUpperCase()}@example.test`,
      password: "secret",
    });
    expect(c.invoke.mock.calls[0]?.[1].body).toEqual({ operation: "delegate", ...input });
    expect(result.content[0]?.text).toMatch(/queued/i);
    expect(result.content[0]?.text).toContain("Fix parser");
    expect(result.content[0]?.text).toContain("FIS-40");
    expect(result.content[0]?.text).not.toMatch(/private-key|12345678|worker|session/);
    expect(result.details).toMatchObject({ task_id: row.id, state: "queued" });
    await h.stop();
    expect(c.stopAutoRefresh).toHaveBeenCalledOnce();
    expect(c.disconnect).toHaveBeenCalledOnce();
  },
);
it("reports missing configuration without authenticating on unrelated startup", async () => {
  vi.stubEnv("PM_TASK_EMAIL", "");
  const h = harness();
  await expect(h.execute()).rejects.toThrow("PM_TASK_EMAIL");
  expect(sdk.create).not.toHaveBeenCalled();
  await h.stop();
});
it.each(["tl", "worker"])("rejects principal mismatch %s and closes resources", async (role) => {
  const c = connection(role);
  const h = harness();
  await expect(h.execute()).rejects.toThrow(/role|authentication/i);
  expect(c.invoke).not.toHaveBeenCalled();
  expect(c.disconnect).toHaveBeenCalledOnce();
  await h.stop();
});
it("rejects invalid instruction and caller identity before auth", async () => {
  const h = harness();
  for (const args of [
    { ...input, role: "pm" },
    { ...input, instruction: { ...input.instruction, summary: " " } },
  ])
    await expect(h.execute(args)).rejects.toThrow("Invalid task contract");
  expect(sdk.create).not.toHaveBeenCalled();
  await h.stop();
});
it("waits for outstanding lazy auth on shutdown without submitting work", async () => {
  const c = connection();
  let resolve!: (value: unknown) => void;
  c.signIn.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const h = harness();
  const pending = h.execute();
  const rejected = expect(pending).rejects.toThrow(/shut|closed/i);
  const stopping = h.stop();
  resolve({ data: { session: { access_token: "token" } }, error: null });
  await stopping;
  await rejected;
  expect(c.invoke).not.toHaveBeenCalled();
  expect(c.disconnect).toHaveBeenCalledOnce();
});
it("aborts and drains outstanding delegation before closing auth", async () => {
  const c = connection();
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  c.invoke.mockImplementation(
    (_name: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          expect(c.disconnect).not.toHaveBeenCalled();
          reject(new Error("abort"));
        });
        entered();
      }),
  );
  const h = harness();
  const pending = h.execute();
  const rejected = expect(pending).rejects.toThrow(/uncertain/i);
  await started;
  await h.stop();
  await rejected;
  expect(c.disconnect).toHaveBeenCalledOnce();
});
it("redacts transport diagnostics that may contain execution IDs or credentials", async () => {
  const c = connection();
  c.invoke.mockRejectedValue(new Error("session-private token secret"));
  const h = harness();
  await expect(h.execute()).rejects.toThrow(/uncertain/i);
  await h.stop();
});
it.each(["running", "completed", "failed"])(
  "shows current %s state without private execution identities",
  async (state) => {
    const c = connection();
    const owned = {
      ...row,
      claimed_by: "private-worker",
      claimed_at: row.created_at,
      opencode_session_id: "private-session",
    };
    const report = {
      schema_version: 1,
      state,
      summary: "Finished",
      checks:
        state === "completed"
          ? [
              {
                criterion_id: "c1",
                result: "passed",
                evidence: [{ locator: "tests", description: "Passed" }],
              },
            ]
          : [],
      artifacts: [],
      failure: state === "failed" ? "Build failed" : null,
    };
    c.invoke.mockResolvedValue({
      data:
        state === "running"
          ? owned
          : {
              ...owned,
              terminal_report: report,
              finished_at: row.created_at,
              result_message_ref: { conversation_id: row.id, id: "abcdef123456" },
            },
      error: null,
    });
    const h = harness();
    const result = await h.execute();
    expect(result.content[0]?.text).toContain(state);
    expect(JSON.stringify(result.content)).not.toMatch(/private-|12345678|abcdef123456/);
    await h.stop();
  },
);
it("shares lazy auth across concurrent tools and shuts down idempotently", async () => {
  const c = connection();
  const h = harness();
  await Promise.all([h.execute(), h.execute()]);
  expect(c.signIn).toHaveBeenCalledOnce();
  await Promise.all([h.stop(), h.stop()]);
  expect(c.disconnect).toHaveBeenCalledOnce();
  await expect(h.execute()).rejects.toThrow(/shut down/);
});
it("checks acknowledgement role against verified principal", async () => {
  const c = connection();
  c.invoke.mockResolvedValue({ data: { ...row, delegator_role: "tl" }, error: null });
  const h = harness();
  await expect(h.execute()).rejects.toThrow(/uncertain/);
  await h.stop();
});
it("redacts definitive SDK rejection details", async () => {
  const c = connection();
  const { FunctionsHttpError } = await import("@supabase/supabase-js");
  c.invoke.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(new Response("private-session secret", { status: 403 })),
  });
  const h = harness();
  await expect(h.execute()).rejects.toThrow(
    "Task delegation rejected; check task access and delegation key/payload before retrying",
  );
  await h.stop();
});
it("permits an explicit retry after authentication rejection, without leaking auth diagnostics", async () => {
  const c = connection();
  c.signIn.mockRejectedValueOnce(new Error("secret token private-session"));
  const h = harness();
  await expect(h.execute()).rejects.toThrow("Task authentication failed");
  await h.execute();
  expect(c.disconnect).toHaveBeenCalledOnce();
  await h.stop();
});
it("propagates tool cancellation to the bounded request without fabricating a terminal state", async () => {
  const c = connection();
  const controller = new AbortController();
  const h = harness();
  await h.execute(input, controller.signal);
  const requestSignal = c.invoke.mock.calls[0]?.[1].signal;
  controller.abort();
  expect(requestSignal?.aborted).toBe(true);
  await h.stop();
});
it("reports unsupported configured role without auth", async () => {
  vi.stubEnv("AGENT_ROLE", "worker");
  const h = harness();
  await expect(h.execute()).rejects.toThrow(/AGENT_ROLE pm or tl/);
  expect(sdk.create).not.toHaveBeenCalled();
  await h.stop();
});
it("redacts cleanup diagnostics on role mismatch", async () => {
  const c = connection("tl");
  c.stopAutoRefresh.mockRejectedValue(new Error("secret token private-session"));
  const h = harness();
  const error: unknown = await h.execute().catch((reason: unknown) => reason);
  expect(String(error)).toMatch(/cleanup/i);
  expect(String(error)).not.toMatch(/secret|token|private-session/);
  expect(c.disconnect).toHaveBeenCalledOnce();
  await h.stop();
});
it("accepts delegation without ticket context", async () => {
  const c = connection();
  const args = { key: input.key, project: input.project, instruction: input.instruction };
  c.invoke.mockResolvedValue({ data: { ...row, ticket_id: null }, error: null });
  const h = harness();
  const result = await h.execute(args);
  expect(result.content[0]?.text).toBe("Task queued: Fix parser");
  expect(c.invoke.mock.calls[0]?.[1].body).toEqual({ operation: "delegate", ...args });
  await h.stop();
});
