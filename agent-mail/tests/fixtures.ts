import type { MessageContent } from "../content.ts";

export const content = (
  summary: string,
  overrides: Partial<MessageContent> = {},
): MessageContent => ({
  schema_version: 1,
  summary,
  context: [],
  findings: [],
  options: [],
  recommendation: null,
  request: null,
  result: null,
  uncertainties: [],
  references: [],
  related_messages: [],
  ...overrides,
});
export const requestContent = (summary: string, requirements: string[] = []) =>
  content(summary, {
    request: {
      action: summary,
      requirements,
      expected_response: "Report findings or honest progress.",
    },
  });
export const completedContent = (summary: string, requirements: string[] = ["Verify the result"]) =>
  content(summary, {
    result: {
      state: "complete",
      accomplished: [summary],
      remaining: [],
      checks: requirements.map((expectation) => ({
        expectation,
        required: true,
        result: "passed",
        explanation: "Verified against the requested behavior.",
        evidence: [{ locator: "tests/fixture.test.ts", note: "Focused check passed." }],
      })),
    },
  });
