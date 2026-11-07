import { expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const state = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: (options: Record<string, unknown>) => {
    state.options = options;
    return Promise.resolve({ session: { bindExtensions: async () => {}, dispose: vi.fn() } });
  },
  DefaultResourceLoader: class { async reload() {} },
  ModelRuntime: { create: async () => ({ registerProvider: vi.fn(), setRuntimeApiKey: vi.fn() }) },
  SessionManager: { inMemory: () => ({ storage: "memory" }) },
  SettingsManager: { inMemory: () => ({}) },
  createMcpExtension: (options: unknown) => options,
}));
import { createRecallSession, recallMcpConfig } from "../recall-session.ts";

test("recall config exposes only reads and never inherits main MCP configuration", () => {
  const config = recallMcpConfig("http://127.0.0.1:8901/mcp");
  expect(config.servers).toHaveLength(1);
  expect(config.servers[0].config).toMatchObject({
    exposure: "hidden", toolExposure: { memory_recall: "direct", memory_get: "direct" },
  });
  expect(() => recallMcpConfig("https://example.com/mcp")).toThrow();
});

test("missing configured model cannot fall back to another provider", async () => {
  await expect(createRecallSession({ model: undefined } as ExtensionContext, {
    url: "http://127.0.0.1:8901/mcp", systemPrompt: "recall", signal: new AbortController().signal,
  })).rejects.toThrow();
  expect(state.options).toBeUndefined();
});
