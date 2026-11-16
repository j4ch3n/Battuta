import { expect, test } from "vitest";
import { describeFailure } from "../errors.ts";

test.each([
  ["insufficient_quota: You exceeded your current quota", "out of credit"],
  ["Your credit balance is too low", "out of credit"],
  ["429 rate limit reached", "rate limited"],
  ["401 invalid api key", "authentication"],
  ["503 Service Unavailable", "unavailable"],
  ["ECONNREFUSED 127.0.0.1", "unavailable"],
  ["fetch failed", "unavailable"],
  ["500 internal error", "API error"],
  ["400 bad request", "API error"],
  ["weird text", "weird text"],
])("describeFailure(%j) mentions %s", (input, expected) => {
  expect(describeFailure(input).toLowerCase()).toContain(expected.toLowerCase());
});

test("unknown or missing text is bounded and never empty", () => {
  expect(describeFailure("x".repeat(5000)).length).toBeLessThanOrEqual(300);
  expect(describeFailure(undefined)).toBe("Execution ended with an unrecoverable error");
  expect(describeFailure("  ")).toBe("Execution ended with an unrecoverable error");
});
