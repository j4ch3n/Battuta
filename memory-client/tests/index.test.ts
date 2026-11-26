import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("../projects.ts", () => ({
  loadProjectCatalog: vi.fn(() => Promise.resolve(["mocktest"])),
}));
import memoryClient from "../index.ts";
import type { MemoryClient } from "../mcp-client.ts";
import { fakeMemory } from "./fake-memory.ts";

afterEach(() => vi.unstubAllEnvs());

type Handler = (event: unknown, ctx: unknown) => unknown;
interface Injected {
  message: { content: string; details: { request_id: string } };
}

function fakePi() {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, unknown>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const ctx = { ui: { setStatus: vi.fn() }, sessionManager: { getSessionId: () => "s1" } };
  const handle = (name: string, event: unknown) => handlers.get(name)!(event, ctx);
  return { pi, handlers, tools, handle };
}

test("injects the owner card and recalls before each owner message", async () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const { client, calls } = fakeMemory({
    memory_profile: { status: "ok", body: "Jason, CEO of Fiscum." },
    memory_project_descriptions: { descriptions: { mocktest: "Banking prototype" } },
    memory_recall: {
      status: "ok",
      memories: [
        { type: "entity", project: "mocktest", abstract: "Acme Ltd is the client", body: "" },
      ],
    },
  });
  const { pi, tools, handle } = fakePi();
  memoryClient(pi, client as MemoryClient);
  expect([...tools.keys()]).toEqual(["memory_recall", "memory_types"]);
  await handle("session_start", {});
  const sections: Record<string, string> = {};
  const event = {
    messageType: "user",
    prompt: "who is the MockTest client?",
    systemPromptOptions: { sections },
  };
  const result = (await handle("before_agent_start", event)) as Injected;
  expect(sections["owner-profile"]).toContain("- mocktest — Banking prototype");
  expect(result.message.content).toContain("[entity/mocktest] Acme Ltd is the client");
  expect(calls.at(-1)).toEqual([
    "memory_recall",
    { query: "who is the MockTest client?", limit: 8 },
  ]);
  const context = handle("context", {
    messages: [
      { role: "custom", customType: "memory-context", details: { request_id: "old" } },
      { role: "custom", customType: "memory-context", details: result.message.details },
      { role: "user", content: "hi" },
    ],
  }) as { messages: unknown[] };
  expect(context.messages).toHaveLength(2);
});

test("registers nothing outside CoS", () => {
  vi.stubEnv("AGENT_ROLE", "manager");
  const { pi, tools, handlers } = fakePi();
  memoryClient(pi, fakeMemory({}).client as MemoryClient);
  expect(tools.size + handlers.size).toBe(0);
});
