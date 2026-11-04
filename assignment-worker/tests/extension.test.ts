import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import worker from "../index.ts";

const backend = vi.hoisted(() => ({
  list: vi.fn(),
  close: vi.fn(),
  remove: vi.fn(),
  subscribe: vi.fn<(callback: (state: string) => void) => void>(),
}));
vi.mock("../client.ts", () => ({
  createAssignmentClient: vi.fn(() =>
    Promise.resolve({ list: backend.list, close: backend.close }),
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
