import { beforeEach, expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const state = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  shutdown: vi.fn(),
  disposed: vi.fn(),
  recallExecute: vi.fn(),
  tools: [] as { name: string; execute: ReturnType<typeof vi.fn> }[],
  enableRecall: true,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: (options: Record<string, unknown>) => {
    state.options = options;
    return Promise.resolve({
      session: {
        agent: { state: { tools: state.tools } },
        extensionRunner: {
          emit: state.shutdown,
          emitBeforeAgentStart: () => {
            if (state.enableRecall)
              state.tools.push({
                name: "mcp__memory__memory_recall",
                execute: state.recallExecute,
              });
            state.tools.push({ name: "mcp__memory__memory_get", execute: vi.fn() });
            return Promise.resolve();
          },
        },
        bindExtensions: () => Promise.resolve(),
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

beforeEach(() => {
  state.options = undefined;
  state.shutdown.mockClear();
  state.disposed.mockClear();
  state.recallExecute.mockReset();
  state.tools = [];
  state.enableRecall = true;
});

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
  const envelope = {
    content: [{ type: "text", text: "read result" }],
    details: { server: "memory", tool: "memory_recall" },
    structuredContent: { structuredContent: { ok: true, data: { validation_evidence: [] } } },
    isError: false,
  };
  state.recallExecute.mockResolvedValue(envelope);
  await expect(child.queryRecall("owner context")).resolves.toEqual(envelope);
  expect(state.recallExecute).toHaveBeenCalledWith(
    "required-memory-recall",
    { semantic_query: "owner context" },
    expect.any(AbortSignal),
  );
  await child.dispose();
  expect(state.shutdown).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
  expect(state.disposed).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});

test("fails safely when the recall tool is absent after extensions bind", async () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  state.enableRecall = false;
  const ctx = {
    cwd: "/tmp",
    model: { provider: "configured", id: "test" },
    modelRegistry: {
      getRegisteredProviderConfig: () => undefined,
      getRegisteredNativeProvider: () => undefined,
      getApiKeyAndHeaders: () => Promise.resolve({ ok: true }),
    },
  } as unknown as ExtensionContext;
  await expect(
    createRecallSession(ctx, {
      url: "http://127.0.0.1:8901/mcp",
      systemPrompt: "child only",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("Isolated memory_recall tool unavailable");
  expect(state.disposed).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});
