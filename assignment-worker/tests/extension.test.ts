import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import worker from "../index.ts";
import { detail } from "./fixtures.ts";

const backend = vi.hoisted(() => ({
  list: vi.fn(),
  claim: vi.fn(),
  close: vi.fn(),
  remove: vi.fn(),
  subscribe: vi.fn<(callback: (state: string) => void) => void>(),
  get: vi.fn(),
  start: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../client.ts", () => ({
  createAssignmentClient: vi.fn(() =>
    Promise.resolve({
      list: backend.list,
      claim: backend.claim,
      close: backend.close,
      get: backend.get,
      start: backend.start,
    }),
  ),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    channel: () => ({
      on(...args: unknown[]) {
        backend.on(...args);
        return this;
      },
      subscribe: backend.subscribe,
    }),
    removeAllChannels: backend.remove,
  }),
}));
vi.mock("../workspace.ts", () => ({
  ensureAssignmentWorkspace: vi.fn(() =>
    Promise.resolve({
      directory: "/private/assignment",
      notePath: "/private/assignment/note.md",
    }),
  ),
}));
beforeEach(() => {
  vi.stubEnv("AGENT_ID", "worker-1");
  vi.stubEnv("BATTUTA_WORKER_CAPABILITIES", "[]");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
test.each(["worker-1", "worker-2"])(
  "configured bot %s claims work and owns its lifecycle",
  async (workerId) => {
    vi.useFakeTimers();
    vi.stubEnv("AGENT_ID", workerId);
    backend.list.mockResolvedValue({ ok: true, assignments: [] });
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
    const sendUserMessage = vi.fn();
    const sendMessage = vi.fn();
    const tools = new Map<
      string,
      { execute: (id: string, args: { abilities: string[] }) => Promise<unknown> }
    >();
    let next: (_args: string, ctx: ExtensionContext) => Promise<void>;
    await worker({
      on: (name: string, fn: unknown) => handlers.set(name, fn as never),
      registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool),
      sendMessage,
      appendEntry: vi.fn(),
      registerCommand: (_name: string, options: { handler: typeof next }) => {
        next = options.handler;
      },
      sendUserMessage,
      setActiveTools: vi.fn(),
    } as unknown as ExtensionAPI);
    expect(backend.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      cwd: "/private/worker",
      newSession: vi.fn(() => Promise.resolve({ cancelled: false })),
      sessionManager: { getEntries: () => [], getSessionId: () => crypto.randomUUID() },
    } as unknown as ExtensionContext;
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    expect(backend.subscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(sendUserMessage).toHaveBeenCalledWith("/worker-next", { expandPromptTemplates: true });
    await next!("", ctx);
    expect(backend.list).toHaveBeenCalledTimes(1);
    expect(tools.has("register_worker_abilities")).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    const row = detail();
    backend.list.mockResolvedValue({ ok: true, assignments: [row.assignment] });
    backend.claim.mockResolvedValue({
      ...row,
      assignment: {
        ...row.assignment,
        status: "in_process",
        claimed_at: "2026-11-05T12:00:00Z",
        claimed_by: workerId,
      },
    });
    backend.get.mockResolvedValue({
      ...row,
      assignment: {
        ...row.assignment,
        status: "in_process",
        claimed_at: "2026-11-05T12:00:00Z",
        claimed_by: workerId,
      },
    });
    const signal = backend.on.mock.calls[0][2] as () => void;
    signal();
    await next!("", ctx);
    expect(backend.claim).toHaveBeenCalledWith({
      project: row.assignment.project,
      assignment_id: row.assignment.id,
      claimed_by: workerId,
      abilities: [],
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(sendUserMessage).toHaveBeenCalledTimes(3);
    backend.subscribe.mock.calls[0][0]("SUBSCRIBED");
    expect(sendUserMessage).toHaveBeenCalledTimes(4);
    await handlers.get("session_shutdown")!({}, ctx);
    await handlers.get("session_shutdown")!({}, ctx);
    expect(vi.getTimerCount()).toBe(0);
    expect(backend.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(sendUserMessage).toHaveBeenCalledTimes(4);
    expect(sendMessage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  },
);

test.each([undefined, "", " "])(
  "refuses startup without a valid configured bot ID: %j",
  async (name) => {
    vi.useFakeTimers();
    vi.stubEnv("AGENT_ID", name);
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
    await worker({
      on: (event: string, handler: never) => handlers.set(event, handler),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      setActiveTools: vi.fn(),
      sendUserMessage: vi.fn(),
    } as unknown as ExtensionAPI);
    const ctx = {
      isIdle: () => true,
      hasPendingMessages: () => false,
      sessionManager: { getSessionId: () => "11111111-1111-4111-8111-111111111111" },
    } as unknown as ExtensionContext;
    const result = await handlers.get("session_start")!({}, ctx).catch((error: unknown) => error);
    await handlers.get("session_shutdown")!({}, ctx);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("AGENT_ID");
    expect(backend.subscribe).not.toHaveBeenCalled();
  },
);

async function promptSections(toolNames: string[]) {
  vi.stubEnv("MODEL_FOR_EASY_TASKS", "anthropic/claude-easy-test");
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  await worker({
    on: (event: string, handler: never) => handlers.set(event, handler),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    setActiveTools: vi.fn(),
    sendUserMessage: vi.fn(),
    getAllTools: () => toolNames.map((name) => ({ name })),
  } as unknown as ExtensionAPI);
  const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
  await handlers.get("before_agent_start")!(event, {} as ExtensionContext);
  return event.systemPromptOptions.sections;
}

test("a bot with the delegate tool gets the delegation model catalog in its prompt", async () => {
  expect((await promptSections(["delegate"]))["delegation-models"]).toContain("claude-easy-test");
});

test("a bot without the delegate tool gets no delegation section", async () => {
  expect(await promptSections(["read"])).not.toHaveProperty("delegation-models");
});

test("a bound native extension dispatches its TODO through Pi without a host sender", async () => {
  vi.useFakeTimers();
  const row = detail();
  row.assignment.status = "in_process";
  row.assignment.claimed_at = "2026-11-05T12:00:00Z";
  backend.get.mockResolvedValue(row);
  backend.start.mockResolvedValue({
    ok: true,
    assignment: row.assignment,
    todo: { ...row.todos[0], status: "in_progress" },
  });
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const sendMessage = vi.fn();
  const tools = new Map<
    string,
    { execute: (id: string, args: { abilities: string[] }) => Promise<unknown> }
  >();
  const setActiveTools = vi.fn();
  let next: (_args: string, ctx: ExtensionContext) => Promise<void>;
  await worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool),
    registerCommand: (_name: string, options: { handler: typeof next }) => {
      next = options.handler;
    },
    appendEntry: vi.fn(),
    sendMessage,
    sendUserMessage: vi.fn(),
    setActiveTools,
  } as unknown as ExtensionAPI);
  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: "assignment-binding",
          data: {
            project: "atlas",
            assignment_id: "1234abcd",
            claimed_at: row.assignment.claimed_at,
          },
        },
      ],
      getSessionId: () => "11111111-1111-4111-8111-111111111111",
      getSessionFile: () => "/private/session.jsonl",
    },
  } as unknown as ExtensionContext;
  await handlers.get("session_start")!({ reason: "new" }, ctx);
  await next!("", ctx);
  expect(tools.has("register_worker_abilities")).toBe(false);
  expect(sendMessage).toHaveBeenCalledWith(
    {
      customType: "assignment-todo",
      content: JSON.stringify({
        assignment: row.assignment,
        todos: row.todos,
        current_todo: { ...row.todos[0], status: "in_progress" },
        workspace: { directory: "/private/assignment", notePath: "/private/assignment/note.md" },
      }),
      display: true,
    },
    { triggerTurn: true },
  );
  expect(setActiveTools).toHaveBeenCalled();
  expect(setActiveTools.mock.calls[0][0]).toContain("report_execution_result");
  for (const tool of [
    "Agent",
    "get_subagent_result",
    "steer_subagent",
    "delegate",
    "delegate_modes",
    "send_agent_message",
    "reply_agent_message",
  ]) {
    expect(setActiveTools.mock.calls[0][0]).toContain(tool);
  }
  expect(setActiveTools.mock.calls[0][0]).not.toContain("mcp__assignments__claim_assignment");
  await handlers.get("session_shutdown")!({}, ctx);
});

test.each([
  undefined,
  "",
  "{",
  "null",
  "{}",
  '["mobile_browse"]',
  "[1]",
  "private-credential-sentinel",
])("invalid configured capabilities %j refuse before networking or a model turn", async (value) => {
  vi.useFakeTimers();
  vi.stubEnv("BATTUTA_WORKER_CAPABILITIES", value);
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const sendMessage = vi.fn();
  await worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage,
    sendUserMessage: vi.fn(),
    setActiveTools: vi.fn(),
  } as unknown as ExtensionAPI);
  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getEntries: () => [], getSessionId: () => crypto.randomUUID() },
  } as unknown as ExtensionContext;
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
  try {
    await expect(handlers.get("session_start")!({ reason: "startup" }, ctx)).rejects.toThrow();
    if (value === "private-credential-sentinel")
      await expect(handlers.get("session_start")!({ reason: "startup" }, ctx)).rejects.not.toThrow(
        "private-cr",
      );
    expect(backend.subscribe).not.toHaveBeenCalled();
    expect(backend.list).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  } finally {
    await handlers.get("session_shutdown")!({}, ctx);
    vi.unstubAllEnvs();
  }
});
