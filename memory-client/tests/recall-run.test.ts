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
      scope: { global: true, projects: [] },
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
        prompt: () => {
          for (let i = 0; i < 2; i++) {
            state.calls++;
            const blocked = hooks.get("tool_call")?.({});
            if (blocked) continue;
            hooks.get("tool_result")?.({
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
  expect(state.calls).toBe(2);
  expect(result.validationEvidence.map((r) => r.ref)).toEqual(["a".repeat(64)]);
  expect(state.dispose).toHaveBeenCalledOnce();
});
test.each(["changed", "provider-error", "pending-capture"])(
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
      { ...options(), capturePending: reason === "pending-capture" },
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
