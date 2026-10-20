import { expect, test } from "vitest";
import { validateDreamPlan, mutationRequest, memoryRecordSchema } from "../dream-mutations.ts";

const a = "a".repeat(64);
const b = "b".repeat(64);
const record = (ref = a, projects = ["atlas"]) => ({
  ref,
  revision: "c".repeat(64),
  content: "Existing fact",
  scope: { global: projects.length === 0, projects },
  kind: "decision",
  tags: [],
  sources: [{ agent_id: "pm", session_id: "s", entry_id: "e" }],
  active: true,
});
const update = {
  id: "correct",
  type: "update",
  ref: a,
  content: "Corrected fact",
  reason: "New evidence",
  source_refs: [a],
};

test("builds versioned updates with snapshot preconditions and stable insert identities", () => {
  const records = [memoryRecordSchema.parse(record())];
  const plan = validateDreamPlan({ operations: [update] }, records, [a]);
  expect(mutationRequest(plan.operations[0], records, "run")).toEqual({
    name: "memory_update",
    arguments: {
      ref: a,
      expected_revision: "c".repeat(64),
      content: "Corrected fact",
      reason: "New evidence",
      evidence: [{ ref: a, revision: "c".repeat(64) }],
      sources: record().sources,
    },
  });
  const insert = {
    id: "merge",
    type: "insert",
    content: "Combined fact",
    kind: "decision",
    source_refs: [a],
  };
  const accepted = validateDreamPlan({ operations: [insert] }, records, [a]);
  expect(mutationRequest(accepted.operations[0], records, "run")).toEqual({
    name: "memory_remember",
    arguments: {
      content: "Combined fact",
      kind: "decision",
      scope: { global: false, projects: ["atlas"] },
      sources: record().sources,
      idempotency_key: "dream:run:merge",
      evidence: [{ ref: a, revision: "c".repeat(64) }],
    },
  });
});

test("requires a saved same-scope replacement before forgetting merged sources", () => {
  const records = [memoryRecordSchema.parse(record())];
  const insert = {
    id: "merge",
    type: "insert",
    content: "Combined fact",
    kind: "decision",
    source_refs: [a],
  };
  const forget = {
    id: "retire",
    type: "forget",
    ref: a,
    reason: "Redundant after merge",
    source_refs: [a],
    replacement_id: "merge",
  };
  const plan = validateDreamPlan({ operations: [insert, forget] }, records, [a]);
  expect(mutationRequest(plan.operations[1], records, "run")).toEqual({
    name: "memory_forget",
    arguments: {
      ref: a,
      expected_revision: "c".repeat(64),
      evidence: [{ ref: a, revision: "c".repeat(64) }],
    },
  });
  expect(() => validateDreamPlan({ operations: [forget, insert] }, records, [a])).toThrow(
    "replacement",
  );
});

test("preflight reserves a guard for merge replacement before any writes", () => {
  const refs = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, "0"));
  const records = refs.map((ref) => memoryRecordSchema.parse(record(ref)));
  const insert = {
    id: "merge",
    type: "insert",
    content: "Combined fact",
    kind: "decision",
    source_refs: refs.slice(0, 100),
  };
  const cleanup = {
    id: "cleanup",
    type: "forget",
    ref: refs[0],
    reason: "Merged",
    replacement_id: "merge",
    source_refs: refs.slice(1),
  };
  expect(() => validateDreamPlan({ operations: [insert, cleanup] }, records, refs)).toThrow(
    "evidence guard limit",
  );
  expect(() =>
    validateDreamPlan(
      { operations: [insert, { ...cleanup, source_refs: refs.slice(0, 100) }] },
      records,
      refs,
    ),
  ).not.toThrow();
});

test("updates include unioned cited sources and reject source overflow before dispatch", () => {
  const first = memoryRecordSchema.parse(record());
  const second = memoryRecordSchema.parse({
    ...record(b),
    sources: [{ agent_id: "tl", session_id: "other", entry_id: "b" }],
  });
  const plan = validateDreamPlan(
    { operations: [{ ...update, source_refs: [a, b] }] },
    [first, second],
    [a],
  );
  expect(mutationRequest(plan.operations[0], [first, second], "run").arguments).toMatchObject({
    sources: [...first.sources, ...second.sources],
    evidence: [first, second].map(({ ref, revision }) => ({ ref, revision })),
  });
  second.sources = Array.from({ length: 201 }, (_, i) => ({
    agent_id: "pm",
    session_id: "many",
    entry_id: String(i),
  }));
  expect(() => mutationRequest(plan.operations[0], [first, second], "run")).toThrow(
    "Too many source",
  );
});

test("preflights update citation limits including uncited existing target sources", () => {
  const first = memoryRecordSchema.parse(record());
  first.sources = Array.from({ length: 150 }, (_, i) => ({
    agent_id: "pm",
    session_id: "target",
    entry_id: String(i),
  }));
  const second = memoryRecordSchema.parse(record(b));
  second.sources = Array.from({ length: 150 }, (_, i) => ({
    agent_id: "pm",
    session_id: "evidence",
    entry_id: String(i),
  }));
  const plan = validateDreamPlan(
    { operations: [{ ...update, source_refs: [b] }] },
    [first, second],
    [b],
  );
  expect(() => mutationRequest(plan.operations[0], [first, second], "run")).toThrow(
    "Too many source",
  );
});

test.each([
  ["unknown citation", [{ ...update, source_refs: [b] }]],
  ["unknown target", [{ ...update, ref: b }]],
  ["repeated target", [update, { ...update, id: "again" }]],
  ["duplicate id", [update, update]],
  ["credential", [{ ...update, content: "token ghp_123456789012345678901234567890123456" }]],
  ["invented scope", [{ ...update, scope: { global: true, projects: [] } }]],
])("rejects %s before applying any operation", (_name, operations) => {
  expect(() =>
    validateDreamPlan({ operations }, [memoryRecordSchema.parse(record())], [a]),
  ).toThrow();
});

test("does not cross scope boundaries or change an untouched scope", () => {
  expect(() =>
    validateDreamPlan({ operations: [update] }, [memoryRecordSchema.parse(record())], []),
  ).toThrow("recent");
  expect(() =>
    validateDreamPlan(
      { operations: [{ ...update, source_refs: [a, b] }] },
      [memoryRecordSchema.parse(record()), memoryRecordSchema.parse(record(b, []))],
      [a],
    ),
  ).toThrow("scope");
});
