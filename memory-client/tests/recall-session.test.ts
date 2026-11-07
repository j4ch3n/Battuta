import { expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const state = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  shutdown: vi.fn(),
  disposed: vi.fn(),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: (options: Record<string, unknown>) => {
    state.options = options;
    return Promise.resolve({
      session: {
        agent: {},
        extensionRunner: { emit: state.shutdown },
        bindExtensions: async () => {},
        dispose: state.disposed,
      },
    });
  },
  DefaultResourceLoader: class {
    async reload() {}
  },
  ModelRuntime: {
    create: () => Promise.resolve({ registerProvider: vi.fn(), setRuntimeApiKey: vi.fn() }),
  },
  SessionManager: { inMemory: () => ({ storage: "memory" }) },
  SettingsManager: { inMemory: () => ({}) },
  createMcpExtension: (options: unknown) => options,
}));
import { createRecallSession, recallMcpConfig } from "../recall-session.ts";

test("recall config exposes only reads and never inherits main MCP configuration", () => {
  const config = recallMcpConfig("http://127.0.0.1:8901/mcp");
  expect(config.servers).toHaveLength(1);
  expect(config.servers[0].config).toMatchObject({
    exposure: "hidden",
    toolExposure: { memory_recall: "direct", memory_get: "direct" },
  });
  expect(() => recallMcpConfig("https://example.com/mcp")).toThrow();
});

test("missing configured model cannot fall back to another provider", async () => {
  await expect(
    createRecallSession({ model: undefined } as ExtensionContext, {
      url: "http://127.0.0.1:8901/mcp",
      systemPrompt: "recall",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(state.options).toBeUndefined();
});

test("our adapter configures an isolated loadout and notifies extensions before disposal", async () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const model = { provider: "configured", id: "test" };
  const ctx = {
    cwd: "/tmp",
    model,
    modelRegistry: {
      getRegisteredProviderConfig: () => undefined,
      getRegisteredNativeProvider: () => undefined,
      getApiKeyAndHeaders: () => Promise.resolve({ ok: true, apiKey: "private-test-key" }),
    },
  } as unknown as ExtensionContext;
  const child = await createRecallSession(ctx, {
    url: "http://127.0.0.1:8901/mcp",
    systemPrompt: "child only",
    signal: new AbortController().signal,
  });
  expect(state.options?.model).toBe(model);
  expect(state.options?.tools).toEqual(["mcp__memory__memory_recall", "mcp__memory__memory_get"]);
  await child.dispose();
  expect(state.shutdown).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
  expect(state.disposed).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});
