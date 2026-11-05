import { expect, test } from "vitest";
import { parseExecutionResult } from "../contracts.ts";

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
