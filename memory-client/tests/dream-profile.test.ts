import { expect, test } from "vitest";
import { renderOwnerProfile, ownerProfileSchema } from "../dream-profile.ts";

const empty = {
  backgroundAndRole: "",
  goalsAndPriorities: "",
  valuesAndDecisionMaking: "",
  lifeContextAndInterests: "",
  enduringPreferencesAndConstraints: "",
};

test("renders every canonical section even without evidence", () => {
  expect(renderOwnerProfile(empty)).toBe(
    "# About Human Product Owner\n\n" +
      "## Background and role\n\n" +
      "## Goals and priorities\n\n" +
      "## Values and decision-making\n\n" +
      "## Life context and interests\n\n" +
      "## Enduring preferences and constraints\n",
  );
});

test("preserves Unicode understanding under the appropriate heading", () => {
  const result = renderOwnerProfile({
    ...empty,
    backgroundAndRole: "产品负责人",
    goalsAndPriorities: "Build useful software.",
  });
  expect(result).toContain(
    "## Background and role\n\n产品负责人\n\n## Goals and priorities\n\nBuild useful software.",
  );
});

test.each([
  { ...empty, projectSummary: "Not personal context" },
  { ...empty, goalsAndPriorities: "# Extra section" },
  { ...empty, backgroundAndRole: "x".repeat(32000) },
  { ...empty, backgroundAndRole: "中".repeat(11000) },
  { ...empty, lifeContextAndInterests: "```markdown\nprofile\n```" },
])("rejects unsupported or oversized profile output %#", (input) => {
  expect(() => renderOwnerProfile(input)).toThrow();
});

test("requires a whole profile rather than a partial patch", () => {
  expect(() => ownerProfileSchema.parse({ goalsAndPriorities: "New goal" })).toThrow();
});
