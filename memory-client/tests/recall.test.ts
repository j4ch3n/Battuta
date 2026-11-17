import { afterEach, expect, test, vi } from "vitest";
import { record } from "./fixtures/record.ts";
import { DreamDiagnosticError } from "../dream-errors.ts";

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
const options = () => ({
  url: "http://127.0.0.1:8901/mcp",
  signal: signal(),
  limit: 10,
  maxDistance: 0.9,
});
const data = (overrides: Record<string, unknown> = {}) => ({
  status: "success",
  context: "- qualified synthetic evidence\n",
  validation_evidence: [record()],
  current_refs: [record().ref],
  omitted_refs: [],
  branches: { semantic: "ready", lexical: "ready" },
  ...overrides,
});

afterEach(() => {
  call.mockReset();
  vi.restoreAllMocks();
});

test("sends limit and max_distance and returns success with evidence re-fetched at the same revision", async () => {
  call.mockImplementation((name) => (name === "memory_recall" ? data() : record()));
  const result = await runRecall(["owner question", "earlier question"], options());
  expect(call).toHaveBeenCalledWith("memory_recall", {
    semantic_queries: ["owner question", "earlier question"],
    limit: 10,
    max_distance: 0.9,
  });
  expect(call).toHaveBeenCalledWith("memory_get", { ref: record().ref });
  expect(result).toMatchObject({ status: "success", context: "- qualified synthetic evidence\n" });
  expect(result.validationEvidence).toEqual([record()]);
});

test("zero matches from a successful search is success with no evidence", async () => {
  call.mockImplementation(() =>
    data({ context: "no relevant memory found", validation_evidence: [], current_refs: [] }),
  );
  const result = await runRecall(["q"], options());
  expect(result).toMatchObject({
    status: "success",
    context: "no relevant memory found",
    validationEvidence: [],
    currentRefs: [],
  });
});

test("a failed branch makes the result partial with a failure notice after the entries", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation((name) =>
    name === "memory_recall"
      ? data({ status: "partial", branches: { semantic: "failed", lexical: "ready" } })
      : record(),
  );
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("partial");
  expect(result.context).toBe(
    "- qualified synthetic evidence\nMemory unavailable: the semantic memory search failed. Please let the human owner know.",
  );
  expect(warn).toHaveBeenCalledWith("Memory recall partial", expect.stringContaining("semantic"));
  expect(warn.mock.calls.flat().join(" ")).not.toContain("qualified synthetic evidence");
});

test("omitted entries make the result partial, name the refs, and keep the other entries", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation((name) =>
    name === "memory_recall"
      ? data({ status: "partial", context: "- kept entry\n", omitted_refs: ["big-ref"] })
      : record(),
  );
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("partial");
  expect(result.context).toContain("- kept entry\n");
  expect(result.context).toContain("memory entries could not be shown (big-ref)");
});

test("omitted entries with no entries left show only the failure notice", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation((name) =>
    name === "memory_recall"
      ? data({
          status: "partial",
          context: "no relevant memory found",
          validation_evidence: [],
          current_refs: [],
          omitted_refs: ["big-ref"],
        })
      : record(),
  );
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("partial");
  expect(result.context).not.toContain("no relevant memory found");
  expect(result.context).toContain("(big-ref)");
});

test("server failed status maps to failed with the failure message", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation(() => data({ status: "failed" }));
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("failed");
  expect(result.context).toBe(
    "Memory unavailable: the memory lookup did not finish. Please let the human owner know.",
  );
});

test.each([
  ["revision changed since search", () => ({ ...record(), revision: "e".repeat(64) })],
  ["evidence failed re-fetch", () => Promise.reject(new Error("backend down"))],
])("failed when %s", async (_label, fetch) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation((name) => (name === "memory_recall" ? data() : fetch()));
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("failed");
});

test.each([
  [
    "backend error code",
    () => new DreamDiagnosticError({ stage: "memory", code: "backend_unavailable", message: "x" }),
    "the memory backend is unavailable",
  ],
  [
    "embedding limit",
    () => new DreamDiagnosticError({ stage: "memory", code: "embedding_limit", message: "x" }),
    "the search text is too long for memory search",
  ],
  [
    "connection refused",
    () => new TypeError("fetch failed"),
    "the memory service is not reachable",
  ],
  [
    "timeout",
    () => Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    "the memory lookup timed out",
  ],
  [
    "unknown failure",
    () => new Error("secret stack detail"),
    "an unexpected memory error occurred",
  ],
])("failed with a friendly reason for %s", async (_label, failure, reason) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockRejectedValue(failure());
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("failed");
  expect(result.context).toBe(`Memory unavailable: ${reason}. Please let the human owner know.`);
  expect(result.context).not.toContain("secret");
});

test("a single entry over the 4000-byte limit fails the recall with a size reason", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  call.mockImplementation((name) =>
    name === "memory_recall" ? data({ context: `- ${"x".repeat(4001)}\n` }) : record(),
  );
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("failed");
  expect(result.context).toContain("the memory context was too large");
});

test("several entries each under 4000 bytes are accepted even when their total exceeds 4000", async () => {
  const entry = (letter: string) => `- ${letter.repeat(3000)}\n`;
  call.mockImplementation((name) =>
    name === "memory_recall" ? data({ context: entry("a") + entry("b") }) : record(),
  );
  const result = await runRecall(["q"], options());
  expect(result.status).toBe("success");
  expect(result.context).toBe(entry("a") + entry("b"));
});
