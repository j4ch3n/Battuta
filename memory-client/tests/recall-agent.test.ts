import { expect, test } from "vitest";
import { RecallCollector } from "../recall-agent.ts";
import { record } from "./fixtures/record.ts";

test.each(["ready", "partial", "skipped"])("cannot invent %s after failed reads", (status) => {
  const collector = new RecallCollector();
  collector.attempt();
  collector.observe(undefined, true);
  expect(collector.finish(JSON.stringify({ status, context: "made up" })).status).toBe(
    "unavailable",
  );
});

test("accumulates repeated read evidence and keeps partial retrieval visible", () => {
  const collector = new RecallCollector();
  const r = record();
  collector.attempt();
  collector.observe(
    {
      structuredContent: {
        ok: true,
        data: { validation_evidence: [r], disclosed_refs: [r.ref], incomplete: true },
      },
    },
    false,
  );
  collector.attempt();
  collector.observe(
    {
      structuredContent: {
        ok: true,
        data: { validation_evidence: [r], disclosed_refs: [r.ref], incomplete: false },
      },
    },
    false,
  );
  const result = collector.finish(JSON.stringify({ status: "ready", context: r.content }));
  expect(result.status).toBe("partial");
  expect(result.validationEvidence.map((v) => v.ref)).toEqual([r.ref]);
});

test.each([
  "not json",
  JSON.stringify({ status: "ready", context: "x" }),
  JSON.stringify({ status: "skipped", context: "x" }),
])("invalid or unsupported outcome is unavailable: %s", (text) => {
  expect(new RecallCollector().finish(text).status).toBe("unavailable");
});

test("zero-call completion is unavailable; oversized UTF-8 packet is never sliced", () => {
  expect(new RecallCollector().finish('{"status":"skipped","context":""}').status).toBe(
    "unavailable",
  );
  const collector = new RecallCollector();
  collector.attempt();
  collector.observe(
    {
      structuredContent: {
        ok: true,
        data: { validation_evidence: [], disclosed_refs: [], incomplete: false },
      },
    },
    false,
  );
  expect(
    collector.finish(JSON.stringify({ status: "ready", context: "遊".repeat(1000) })).status,
  ).toBe("unavailable");
});
