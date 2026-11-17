import { afterEach, expect, test, vi } from "vitest";
import { record } from "./fixtures/record.ts";

const call = vi.hoisted(() => vi.fn<(name: string, args: Record<string, unknown>) => unknown>());
vi.mock("../mcp-client.ts", () => ({
  MemoryMcpClient: class {
    call(name: string, args: Record<string, unknown>) {
      return call(name, args);
    }
  },
}));

import { runRecall } from "../recall.ts";

const signal = () => new AbortController().signal;
const data = (overrides: Record<string, unknown> = {}) => ({
  context: "qualified synthetic evidence",
  validation_evidence: [record()],
  current_refs: [record().ref],
  incomplete: false,
  ...overrides,
});

afterEach(() => call.mockReset());

test("returns ready context whose evidence is re-fetched at the same revision", async () => {
  call.mockImplementation((name) => (name === "memory_recall" ? data() : record()));
  const result = await runRecall("owner question", {
    url: "http://127.0.0.1:8901/mcp",
    signal: signal(),
  });
  expect(call).toHaveBeenCalledWith("memory_recall", { semantic_query: "owner question" });
  expect(call).toHaveBeenCalledWith("memory_get", { ref: record().ref });
  expect(result).toMatchObject({ status: "ready", context: "qualified synthetic evidence" });
  expect(result.validationEvidence).toEqual([record()]);
});

test("marks incomplete retrieval as partial", async () => {
  call.mockImplementation((name) =>
    name === "memory_recall" ? data({ incomplete: true }) : record(),
  );
  const result = await runRecall("q", { url: "http://127.0.0.1:8901/mcp", signal: signal() });
  expect(result.status).toBe("partial");
});

test("an empty completed search is ready with no evidence, not unavailable", async () => {
  call.mockImplementation(() =>
    data({
      context: "No relevant eligible records found.",
      validation_evidence: [],
      current_refs: [],
    }),
  );
  const result = await runRecall("q", { url: "http://127.0.0.1:8901/mcp", signal: signal() });
  expect(result).toMatchObject({ status: "ready", validationEvidence: [], currentRefs: [] });
});

test.each([
  ["revision changed since search", () => ({ ...record(), revision: "e".repeat(64) })],
  ["evidence failed re-fetch", () => Promise.reject(new Error("backend down"))],
])("unavailable when %s", async (_label, fetch) => {
  call.mockImplementation((name) => (name === "memory_recall" ? data() : fetch()));
  const result = await runRecall("q", { url: "http://127.0.0.1:8901/mcp", signal: signal() });
  expect(result.status).toBe("unavailable");
});

test("unavailable when the search call fails", async () => {
  call.mockRejectedValue(new Error("Memory backend unavailable"));
  const result = await runRecall("q", { url: "http://127.0.0.1:8901/mcp", signal: signal() });
  expect(result.context).toBe("Memory unavailable; this is not an empty memory inventory.");
});

test("unavailable when returned context exceeds the 2000-byte packet limit", async () => {
  call.mockImplementation((name) =>
    name === "memory_recall" ? data({ context: "x".repeat(2001) }) : record(),
  );
  const result = await runRecall("q", { url: "http://127.0.0.1:8901/mcp", signal: signal() });
  expect(result.status).toBe("unavailable");
});
