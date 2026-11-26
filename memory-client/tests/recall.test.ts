import { expect, test } from "vitest";
import { MemoryError } from "../mcp-client.ts";
import { NO_MEMORY, runRecall } from "../recall.ts";
import { fakeMemory } from "./fake-memory.ts";

const signal = new AbortController().signal;

test("renders recalled memories as labelled context", async () => {
  const { client, calls } = fakeMemory({
    memory_recall: {
      status: "ok",
      memories: [
        {
          name: "n",
          type: "entity",
          project: "mocktest",
          abstract: "Acme Ltd is the client",
          body: "Signed\n2026.",
          updated: "x",
        },
      ],
    },
  });
  const text = await runRecall(client, "who is the client?", signal);
  expect(text).toContain("- [entity/mocktest] Acme Ltd is the client — Signed 2026.");
  expect(calls).toEqual([["memory_recall", { query: "who is the client?", limit: 8 }]]);
});

test("reports an empty result", async () => {
  const { client } = fakeMemory({ memory_recall: { status: "ok", memories: [] } });
  expect(await runRecall(client, "x", signal)).toBe(NO_MEMORY);
});

test.each([
  [
    new MemoryError("backend_unavailable", "down"),
    "the memory service reported backend_unavailable",
  ],
  [new TypeError("fetch failed"), "the memory service is not reachable"],
  [{ status: "invalid" }, "the memory service returned an unexpected response"],
])("says memory is unavailable instead of throwing", async (reply, reason) => {
  const { client } = fakeMemory({ memory_recall: reply });
  expect(await runRecall(client, "x", signal)).toContain(`Memory unavailable: ${reason}.`);
});
