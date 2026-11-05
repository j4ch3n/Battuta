import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import worker from "../index.ts";
import { detail } from "./fixtures.ts";

const backend = vi.hoisted(() => ({
  list: vi.fn(),
  close: vi.fn(),
  remove: vi.fn(),
  subscribe: vi.fn<(callback: (state: string) => void) => void>(),
  get: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../client.ts", () => ({
  createAssignmentClient: vi.fn(() =>
    Promise.resolve({
      list: backend.list,
      close: backend.close,
      get: backend.get,
      start: backend.start,
    }),
  ),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    channel: () => ({
      on() {
        return this;
      },
      subscribe: backend.subscribe,
    }),
    removeAllChannels: backend.remove,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
test("factory is inert; session lifecycle owns one timer/socket and shutdown fences stale callbacks", async () => {
  vi.useFakeTimers();
  backend.list.mockResolvedValue({ ok: true, assignments: [] });
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const sendUserMessage = vi.fn();
  let next: (_args: string, ctx: ExtensionContext) => Promise<void>;
  worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: vi.fn(),
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
  await vi.advanceTimersByTimeAsync(30000);
  expect(sendUserMessage).toHaveBeenCalledTimes(2);
  backend.subscribe.mock.calls[0][0]("SUBSCRIBED");
  expect(sendUserMessage).toHaveBeenCalledTimes(3);
  await handlers.get("session_shutdown")!({}, ctx);
  await handlers.get("session_shutdown")!({}, ctx);
  expect(vi.getTimerCount()).toBe(0);
  expect(backend.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(sendUserMessage).toHaveBeenCalledTimes(3);
  vi.unstubAllEnvs();
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
  const setActiveTools = vi.fn();
  let next: (_args: string, ctx: ExtensionContext) => Promise<void>;
  worker({
    on: (name: string, fn: unknown) => handlers.set(name, fn as never),
    registerTool: vi.fn(),
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
  expect(sendMessage).toHaveBeenCalledWith(
    {
      customType: "assignment-todo",
      content: JSON.stringify({
        assignment: row.assignment,
        todos: row.todos,
        current_todo: { ...row.todos[0], status: "in_progress" },
      }),
      display: true,
    },
    { triggerTurn: true },
  );
  expect(setActiveTools).toHaveBeenCalled();
  expect(setActiveTools.mock.calls[0][0]).toContain("report_execution_result");
  expect(setActiveTools.mock.calls[0][0]).not.toContain("mcp__assignments__claim_assignment");
  await handlers.get("session_shutdown")!({}, ctx);
});
