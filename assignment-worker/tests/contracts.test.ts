import { expect, test } from "vitest";
import {
  fill,
  messageText,
  parseAbilities,
  parseBinding,
  parseExecutionResult,
} from "../contracts.ts";

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

test("a completed report needs outcome, summary and evidence and nothing else", () => {
  expect(
    parseExecutionResult({
      outcome: "completed",
      summary: "Verified",
      evidence: ["pnpm test: 180 passed"],
    }),
  ).toEqual({ outcome: "completed", summary: "Verified", evidence: ["pnpm test: 180 passed"] });
});

test("a blocked report with a blocker is accepted", () => {
  expect(
    parseExecutionResult({
      outcome: "blocked",
      summary: "Cannot reach the API",
      evidence: [],
      blocker: "Missing API key",
    }),
  ).toEqual({
    outcome: "blocked",
    summary: "Cannot reach the API",
    evidence: [],
    blocker: "Missing API key",
  });
});

test.each([
  [
    "blocked without blocker",
    { outcome: "blocked", summary: "Stopped", evidence: [] },
    /blocker is required when outcome is "blocked"/,
  ],
  ["missing summary", { outcome: "completed", evidence: [] }, /summary is required/],
  [
    "wrong outcome",
    { outcome: "done", summary: "Done", evidence: [] },
    /outcome must be "completed" or "blocked"; got "done"/,
  ],
  ["missing outcome", { summary: "Done", evidence: [] }, /outcome is required/],
  [
    "blocker on a completed report",
    { outcome: "completed", summary: "Done", evidence: [], blocker: "none" },
    /blocker is only allowed when outcome is "blocked"/,
  ],
  [
    "unknown field",
    { outcome: "completed", summary: "Done", evidence: [], assignment_id: "1234abcd" },
    /Unknown report field "assignment_id"/,
  ],
  [
    "evidence not an array",
    { outcome: "completed", summary: "Done", evidence: "proof" },
    /evidence is required/,
  ],
])("%s is rejected with a field-specific message", (_name, value, message) => {
  expect(() => parseExecutionResult(value)).toThrow(message);
});

test.each([
  ["assignment_id", "1234abcd"],
  ["worker", "worker-1"],
  ["claimed_at", "2026-11-04T12:00:00.123456+00:00"],
  ["position", "3"],
] as const)("fill substitutes {%s} in objective and body", (name, value) => {
  const filled = fill(
    { objective: `A {${name}} B`, body: `{${name}}{${name}}` },
    { [name]: value },
  );
  expect(filled).toEqual({ objective: `A ${value} B`, body: `${value}${value}` });
});
test("messageText puts a blank line between objective and body", () => {
  expect(messageText({ objective: "Stop", body: "Reason" })).toBe("Stop\n\nReason");
});
