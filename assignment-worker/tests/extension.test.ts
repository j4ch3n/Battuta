import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import worker from "../index.ts";
import { delegateClaudeForAssignment } from "../claude-run.ts";
import { detail } from "./fixtures.ts";

vi.mock("../claude-run.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../claude-run.ts")>()),
  delegateClaudeForAssignment: vi.fn(),
}));

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
    worker({
      on: (name: string, fn: unknown) => handlers.set(name, fn as never),
      registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool),
      sendMessage,
      appendEntry: vi.fn(),
      registerCommand: (_name: string, options: { handler: typeof next }) => {
        next = options.handler;
      },
      sendUserMessage,
      setActiveTools: vi.fn(),
      getAllTools: () => [],
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
    worker({
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
  worker({
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
  worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool),
    registerCommand: (_name: string, options: { handler: typeof next }) => {
      next = options.handler;
    },
    appendEntry: vi.fn(),
    sendMessage,
    sendUserMessage: vi.fn(),
    setActiveTools,
    getAllTools: () => [{ name: "delegate" }],
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
    "delegate_claude_assignment",
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
  worker({
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

function loadWorker() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    setActiveTools: vi.fn(),
  } as unknown as ExtensionAPI);
  return { handlers, tools };
}

/** Starts the worker session with the given installed tool names and returns its registrations. */
async function startWorker(installedTools: string[]) {
  vi.useFakeTimers();
  backend.list.mockResolvedValue({ ok: true, assignments: [] });
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-key");
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  const setActiveTools = vi.fn();
  worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    setActiveTools,
    getAllTools: () => installedTools.map((name) => ({ name })),
  } as unknown as ExtensionAPI);
  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getEntries: () => [], getSessionId: () => crypto.randomUUID() },
  } as unknown as ExtensionContext;
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  const activeTools = (setActiveTools.mock.calls[0] as unknown as [string[]])[0];
  return {
    tools,
    activeTools,
    stop: () => handlers.get("session_shutdown")!({}, ctx),
  };
}

function sessionCtx(entries: unknown[]) {
  return {
    sessionManager: {
      getEntries: () => entries,
      getSessionFile: () => "/private/session.jsonl",
    },
  } as unknown as ExtensionContext;
}

test("the generic delegate tool is blocked for Claude but other harnesses still pass", () => {
  const { handlers } = loadWorker();
  const toolCall = handlers.get("tool_call") as (
    event: unknown,
  ) => { block?: boolean; reason?: string } | undefined;
  const claude = toolCall({
    type: "tool_call",
    toolCallId: "1",
    toolName: "delegate",
    input: { harness: "claude", task: "x" },
  });
  expect(claude?.block).toBe(true);
  expect(claude?.reason).toContain("delegate_claude_assignment");
  expect(
    toolCall({
      type: "tool_call",
      toolCallId: "2",
      toolName: "delegate",
      input: { harness: "codex", task: "x" },
    }),
  ).toBeUndefined();
  expect(
    toolCall({ type: "tool_call", toolCallId: "3", toolName: "read", input: { path: "x" } }),
  ).toBeUndefined();
});

test("the Claude delegation tool runs for the bound assignment's project with the brief's worktree", async () => {
  const { tools, stop } = await startWorker(["delegate"]);
  const tool = tools.get("delegate_claude_assignment")!;
  vi.mocked(delegateClaudeForAssignment).mockResolvedValue({
    text: "ok",
    isError: false,
    sessionId: "session-9",
    totalCostUsd: null,
    numTurns: 1,
    permissionDenials: [],
    cwd: "/w",
    source: "worktree",
  });
  const signal = new AbortController().signal;
  const bound = sessionCtx([
    {
      type: "custom",
      customType: "assignment-binding",
      data: { project: "atlas", assignment_id: "1234abcd", claimed_at: "2026-11-05T12:00:00Z" },
    },
  ]);
  const result = await tool.execute(
    "call-1",
    { task: "do it", tier: "economy", permission: "edit", worktree: "/w" },
    signal,
    undefined,
    bound,
  );
  expect(delegateClaudeForAssignment).toHaveBeenCalledWith(
    {
      task: "do it",
      tier: "economy",
      permission: "edit",
      worktree: "/w",
      project: "atlas",
      signal,
    },
    { projectsRoot: join(homedir(), ".battuta", "projects"), env: process.env },
  );
  expect(result).toEqual({
    content: [{ type: "text", text: "ok" }],
    details: {
      cwd: "/w",
      source: "worktree",
      sessionId: "session-9",
      totalCostUsd: null,
      numTurns: 1,
      permissionDenials: [],
    },
  });
  await stop();
});

test("the Claude delegation tool refuses in an unbound session without starting Claude", async () => {
  const { tools, stop } = await startWorker(["delegate"]);
  const tool = tools.get("delegate_claude_assignment")!;
  vi.mocked(delegateClaudeForAssignment).mockClear();
  await expect(
    tool.execute(
      "call-2",
      { task: "x", tier: "economy", permission: "readonly" },
      undefined,
      undefined,
      sessionCtx([]),
    ),
  ).rejects.toThrow("not bound to an assignment");
  expect(delegateClaudeForAssignment).not.toHaveBeenCalled();
  await stop();
});

test.each([
  ["an omitted harness", {}],
  ["an empty harness", { harness: "" }],
  ["all harnesses", { harness: "all" }],
  ["a fan-out that includes claude", { harness: "codex,claude" }],
  ["a fan-out resume", { harness: "codex", resumeFanout: "fan_1" }],
  ["a resume without a harness", { resumeFanout: "fan_1" }],
])("the generic delegate tool is blocked through the hook for %s", (_label, input) => {
  const { handlers } = loadWorker();
  const toolCall = handlers.get("tool_call") as (
    event: unknown,
  ) => { block?: boolean; reason?: string } | undefined;
  const result = toolCall({ type: "tool_call", toolCallId: "5", toolName: "delegate", input });
  expect(result?.block).toBe(true);
  expect(result?.reason).toContain("delegate_claude_assignment");
});

test("a fan-out of only other harnesses passes the hook", () => {
  const { handlers } = loadWorker();
  const toolCall = handlers.get("tool_call") as (event: unknown) => unknown;
  expect(
    toolCall({
      type: "tool_call",
      toolCallId: "6",
      toolName: "delegate",
      input: { harness: "codex,opencode", task: "x" },
    }),
  ).toBeUndefined();
});

test.each([{ task: "x" }, { task: "x", harness: "codex" }])(
  "the deprecated claude_delegate alias is always blocked: %j",
  (input) => {
    const { handlers } = loadWorker();
    const toolCall = handlers.get("tool_call") as (
      event: unknown,
    ) => { block?: boolean; reason?: string } | undefined;
    const result = toolCall({
      type: "tool_call",
      toolCallId: "7",
      toolName: "claude_delegate",
      input,
    });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("delegate_claude_assignment");
  },
);

test("a bot with the delegate package registers and activates the Claude tool", async () => {
  const worker = await startWorker(["delegate", "delegate_modes", "read"]);
  expect(worker.tools.has("delegate_claude_assignment")).toBe(true);
  expect(worker.activeTools).toContain("delegate_claude_assignment");
  await worker.stop();
});

test("a bot without the delegate package (influencer) gets neither the Claude tool nor its prompt section", async () => {
  const worker = await startWorker(["read", "bash", "pi-droid-tool"]);
  expect(worker.tools.has("delegate_claude_assignment")).toBe(false);
  expect(worker.activeTools).not.toContain("delegate_claude_assignment");
  await worker.stop();
  expect(await promptSections(["read", "bash", "pi-droid-tool"])).not.toHaveProperty(
    "delegation-models",
  );
});
