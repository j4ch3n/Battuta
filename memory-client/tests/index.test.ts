import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryMcpClient } from "../mcp-client.ts";
import { record } from "./fixtures/record.ts";
import { CaptureQueue } from "../capture-queue.ts";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("extension does not register legacy profile or memory tools", () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const tools: unknown[] = [];
  const hooks: string[] = [];
  extension({
    on: (event: string) => {
      hooks.push(event);
    },
    registerTool: (tool: unknown) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI);
  expect(tools).toEqual([]);
  expect(hooks).toContain("before_agent_start");
});

test("admission recalls even with capture disabled and removes another request's injected packet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-admission-"));
  try {
    vi.stubEnv("AGENT_ROLE", "cos");
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", join(dir, "memory"));
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ battutaMemoryCapture: { enabled: false } }),
    );
    const r = record();
    vi.spyOn(MemoryMcpClient.prototype, "call").mockImplementation((name) =>
      Promise.resolve(name === "memory_get" ? r : { records: [r] }),
    );
    const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
    const entries = [
      {
        type: "custom",
        customType: "memory-request-origin",
        data: {
          request_id: "admitted",
          conversation_id: "owner-chat",
          session_id: "s",
          project: null,
          origin: "owner",
          admitted_at: "2026-11-06T00:00:00Z",
        },
      },
    ];
    extension({
      on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
        hooks.set(name, handler),
      appendEntry: () => {},
    } as unknown as ExtensionAPI);
    const ctx = {
      sessionManager: { getSessionId: () => "s", getBranch: () => entries },
      ui: { setStatus: () => {}, notify: () => {} },
    } as unknown as ExtensionContext;
    const result = await hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "Nintendo games", systemPrompt: "unchanged" },
      ctx,
    );
    expect(result).toHaveProperty("message.customType", "memory-context");
    expect(result).toHaveProperty(
      "message.content",
      expect.stringContaining("Owner bought an NS2"),
    );
    expect(result).not.toHaveProperty("systemPrompt");
    const context = await hooks.get("context")!(
      {
        messages: [
          { role: "custom", customType: "memory-context", details: { request_id: "old" } },
          { role: "custom", customType: "memory-context", details: { request_id: "admitted" } },
        ],
      },
      ctx,
    );
    expect(context).toMatchObject({ messages: [{ details: { request_id: "admitted" } }] });
    const queue = await CaptureQueue.open(join(dir, "memory/capture-queue/cos"), "cos");
    await queue.track("earlier", [], null, false);
    await queue.track(
      "earlier",
      [{ type: "message", id: "correction", message: { role: "user", content: "I returned it" } }],
      null,
      true,
    );
    entries[0].data.request_id = "pending";
    const pending = await hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "Nintendo games", systemPrompt: "unchanged" },
      ctx,
    );
    expect(pending).toHaveProperty("message.content", expect.stringContaining("capture-pending"));
    expect(pending).not.toHaveProperty(
      "message.content",
      expect.stringContaining("Owner bought an NS2"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(["manager", "worker", ""])("%s cannot register memory hooks", (role) => {
  vi.stubEnv("AGENT_ROLE", role);
  const hooks: string[] = [];
  extension({ on: (event: string) => hooks.push(event) } as unknown as ExtensionAPI);
  expect(hooks).toEqual([]);
});
