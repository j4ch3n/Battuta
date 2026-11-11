import { afterEach, expect, test, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { record } from "./fixtures/record.ts";
import { MemoryMcpClient } from "../mcp-client.ts";

const state = vi.hoisted(() => ({
  final: '{"status":"ready","context":"qualified evidence"}',
  stop: "stop",
  dispose: vi.fn(),
  pending: false,
  calls: 0,
  requiredCalls: 0,
  childQueries: true,
  childGets: false,
  getCalls: 0,
  lastPrompt: undefined as string | undefined,
  requiredFails: false,
}));
vi.mock("../recall-session.ts", () => ({
  createRecallSession: (_ctx: unknown, options: { observe: ExtensionFactory }) => {
    const hooks = new Map<string, (event: unknown) => unknown>();
    void options.observe({
      on: (name: string, handler: (event: unknown) => unknown) => hooks.set(name, handler),
    } as unknown as ExtensionAPI);
    const r = {
      ref: "a".repeat(64),
      revision: "f".repeat(64),
      content: "Owner bought an NS2",
      projects: ["global"],
      kind: "event",
      tags: [],
      sources: [{ agent_id: "cos", session_id: "s", entry_id: "e" }],
      active: true,
      memory_metadata: {
        stage: "temporal",
        knowledge_type: "fact",
        confidence: "confirmed",
        status: "active",
        keywords: [],
        evidence: [],
      },
    };
    return Promise.resolve({
      session: {
        subscribe: () => {},
        messages: [
          {
            role: "assistant",
            get stopReason() {
              return state.stop;
            },
          },
        ],
        prompt: (prompt: string) => {
          state.lastPrompt = prompt;
          if (state.childGets) {
            state.getCalls++;
            hooks.get("tool_call")?.({ toolName: "mcp__memory__memory_get" });
            hooks.get("tool_result")?.({
              toolName: "mcp__memory__memory_get",
              structuredContent: { structuredContent: { ok: false } },
              isError: true,
            });
          }
          if (state.childQueries)
            for (let i = 0; i < 2; i++) {
              state.calls++;
              const blocked = hooks.get("tool_call")?.({ toolName: "mcp__memory__memory_recall" });
              if (blocked) continue;
              hooks.get("tool_result")?.({
                toolName: "mcp__memory__memory_recall",
                structuredContent: {
                  structuredContent: {
                    ok: true,
                    data: {
                      validation_evidence: [r],
                      current_refs: [r.ref],
                      incomplete: false,
                    },
                  },
                },
                isError: false,
              });
            }
          return state.pending ? new Promise<void>(() => {}) : Promise.resolve();
        },
        getLastAssistantText: () => state.final,
      },
      queryRecall: () => {
        state.requiredCalls++;
        return Promise.resolve({
          isError: state.requiredFails,
          structuredContent: state.requiredFails
            ? { structuredContent: { ok: false } }
            : {
                structuredContent: {
                  ok: true,
                  data: {
                    validation_evidence: [r],
                    current_refs: [r.ref],
                    incomplete: false,
                  },
                },
              },
        });
      },
      dispose: state.dispose,
    });
  },
}));
import { runRecallAgent } from "../recall-agent.ts";
afterEach(() => {
  vi.restoreAllMocks();
  state.dispose.mockClear();
  state.final = '{"status":"ready","context":"qualified evidence"}';
  state.stop = "stop";
  state.pending = false;
  state.calls = 0;
  state.requiredCalls = 0;
  state.childQueries = true;
  state.childGets = false;
  state.getCalls = 0;
  state.lastPrompt = undefined;
  state.requiredFails = false;
});

const options = (signal = new AbortController().signal) => ({
  url: "http://localhost:8901/mcp",
  signal,
  capturePending: false,
  onUsage: () => {},
});
test("our runner accumulates repeated read notifications, verifies evidence and disposes", async () => {
  vi.spyOn(MemoryMcpClient.prototype, "call").mockResolvedValue(record());
  const result = await runRecallAgent(
    { history: [], current: "games?" },
    {} as ExtensionContext,
    options(),
  );
  expect(result.status).toBe("ready");
  expect(state.requiredCalls).toBe(1);
  expect(state.calls).toBe(2);
  expect(result.validationEvidence.map((r) => r.ref)).toEqual(["a".repeat(64)]);
  expect(state.dispose).toHaveBeenCalledOnce();
});
test("the required query reaches isolated enrichment when the child makes no additional tool call", async () => {
  state.childQueries = false;
  vi.spyOn(MemoryMcpClient.prototype, "call").mockResolvedValue(record());
  const result = await runRecallAgent(
    { history: [], current: "hello" },
    {} as ExtensionContext,
    options(),
  );
  expect(result.status).toBe("ready");
  expect(state.requiredCalls).toBe(1);
  expect(state.calls).toBe(0);
  expect(JSON.parse(state.lastPrompt ?? "{}")).toMatchObject({
    required_query_result: {
      structuredContent: {
        ok: true,
        data: { current_refs: ["a".repeat(64)] },
      },
    },
  });
});

test("a skipped no-tool child still awaits an isolated memory_recall outcome", async () => {
  state.final = '{"status":"skipped","context":""}';
  state.childQueries = false;
  vi.spyOn(MemoryMcpClient.prototype, "call").mockResolvedValue(record());
  const result = await runRecallAgent(
    { history: [], current: "hello" },
    {} as ExtensionContext,
    options(),
  );
  expect(state.requiredCalls).toBe(1);
  expect(state.calls).toBe(0);
  expect(result.status).toBe("unavailable");
  expect(state.dispose).toHaveBeenCalledOnce();
});

test("memory_get results do not count as an additional recall", async () => {
  state.childQueries = false;
  state.childGets = true;
  vi.spyOn(MemoryMcpClient.prototype, "call").mockResolvedValue(record());
  const result = await runRecallAgent(
    { history: [], current: "hello" },
    {} as ExtensionContext,
    options(),
  );
  expect(state.getCalls).toBe(1);
  expect(state.calls).toBe(0);
  expect(result.validationEvidence.map((r) => r.ref)).toEqual(["a".repeat(64)]);
});

test("a failed isolated memory_recall outcome is unavailable without invoking the child model", async () => {
  state.requiredFails = true;
  const result = await runRecallAgent(
    { history: [], current: "hello" },
    {} as ExtensionContext,
    options(),
  );
  expect(state.requiredCalls).toBe(1);
  expect(state.calls).toBe(0);
  expect(result.status).toBe("unavailable");
  expect(state.dispose).toHaveBeenCalledOnce();
});

test.each(["changed", "provider-error"])(
  "%s cannot disclose a successful packet",
  async (reason) => {
    vi.spyOn(MemoryMcpClient.prototype, "call").mockResolvedValue({
      ...record(),
      revision: "b".repeat(64),
    });
    if (reason === "provider-error") state.stop = "error";
    const result = await runRecallAgent(
      { history: [], current: "games?" },
      {} as ExtensionContext,
      options(),
    );
    expect(result.status).toBe("unavailable");
    expect(result.validationEvidence).toEqual([]);
    expect(state.dispose).toHaveBeenCalledOnce();
  },
);
test("our cancellation race releases an unresolved child and never returns facts", async () => {
  state.pending = true;
  const controller = new AbortController();
  const running = runRecallAgent(
    { history: [], current: "games?" },
    {} as ExtensionContext,
    options(controller.signal),
  );
  controller.abort();
  expect((await running).status).toBe("unavailable");
});
