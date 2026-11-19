import type { MessageContent } from "../content.ts";

export const content = (
  objective: string,
  overrides: Partial<MessageContent> = {},
): MessageContent => ({
  project: "atlas",
  objective,
  ...overrides,
});
export const requestContent = (objective: string, requirements: string[] = []) =>
  content(objective, { requirements });
export const completedContent = (
  objective: string,
  requirements: string[] = ["Verify the result"],
) =>
  content(objective, {
    result: {
      state: "complete",
      checks: requirements.map((_, index) => ({
        req: index + 1,
        result: "passed" as const,
        evidence: "tests/fixture.test.ts",
      })),
    },
  });
