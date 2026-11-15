import { expect, test } from "vitest";
import { parseAbilities, parseBinding, parseExecutionResult } from "../contracts.ts";

test.each(["completed", "blocked"] as const)(
  "accepts truthful %s with exact nonblank evidence",
  (outcome) => {
    const value = {
      outcome,
      summary: "Verified result",
      evidence: ["tests/proof.ts"],
      ...(outcome === "blocked" ? { blocker: "Missing input" } : {}),
    };
    expect(parseExecutionResult(value)).toEqual(value);
    expect(parseExecutionResult({ ...value, evidence: [] })).toEqual({ ...value, evidence: [] });
  },
);
test.each([
  { summary: "\u00a0" },
  { summary: "bad\0value" },
  { outcome: "blocked" },
  { evidence: [" "] },
  { evidence: [null] },
  { evidence: [["nested"]] },
  { assignment_id: "12345678" },
  { claimed_at: "token" },
  { blocker: "Unexpected" },
])("rejects malformed or identity-bearing reports: %j", (patch) => {
  expect(() =>
    parseExecutionResult({ outcome: "completed", summary: "Done", evidence: [], ...patch }),
  ).toThrow();
});

test("saved bindings preserve exact ownership tokens but use the current session file", () => {
  const saved = {
    project: "Atlas",
    assignment_id: "1234abcd",
    claimed_at: "2026-11-04T12:00:00.123456+00:00",
    claimed_by: "worker-a",
    session_file: "/old",
  };
  expect(parseBinding(saved, "/current")).toEqual({ ...saved, session_file: "/current" });
  const legacy = {
    project: saved.project,
    assignment_id: saved.assignment_id,
    claimed_at: saved.claimed_at,
  };
  expect(parseBinding(legacy, "/current").claimed_by).toBeNull();
  for (const value of [
    null,
    {},
    { ...saved, claimed_at: "not-time" },
    { ...saved, claimed_by: {} },
  ])
    expect(() => parseBinding(value, "/current")).toThrow();
});
test("session ability registration validates the empty catalog and malformed proposals", () => {
  expect([...parseAbilities([])]).toEqual([]);
  for (const value of [["mobile_use"], ["constructor"], null, "[]", [null], [["nested"]]])
    expect(() => parseAbilities(value)).toThrow();
});
