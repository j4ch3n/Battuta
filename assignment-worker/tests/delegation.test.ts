import { expect, test } from "vitest";
import { delegationCatalog, renderDelegationSection } from "../delegation.ts";

test.each([
  ["MODEL_FOR_EASY_TASKS", "economy"],
  ["MODEL_FOR_MEDIUM_TASKS", "balanced"],
  ["MODEL_FOR_HARD_TASKS", "max"],
] as const)("%s maps to the %s tier with the provider stripped", (variable, tier) => {
  expect(delegationCatalog({ [variable]: "anthropic/claude-x-1" })).toEqual([
    { tier, variable, model: "claude-x-1" },
  ]);
});

test("entries follow tier order and hail-mary is not offered", () => {
  const catalog = delegationCatalog({
    MODEL_FOR_HARD_TASKS: "anthropic/c",
    MODEL_FOR_EASY_TASKS: "anthropic/a",
    MODEL_FOR_HAIL_MARY_TASKS: "anthropic/h",
  });
  expect(catalog.map((entry) => entry.tier)).toEqual(["economy", "max"]);
});

test.each([undefined, "", "  "])("unset value %j leaves the tier out", (value) => {
  expect(delegationCatalog({ MODEL_FOR_EASY_TASKS: value })).toEqual([]);
});

test.each(["openai/gpt-x", "gpt-x", "anthropic/", "/gpt-x"])(
  "value %j is unusable and names its variable",
  (value) => {
    const [entry] = delegationCatalog({ MODEL_FOR_MEDIUM_TASKS: value });
    expect(entry).toMatchObject({ tier: "balanced", variable: "MODEL_FOR_MEDIUM_TASKS" });
    expect("error" in entry).toBe(true);
  },
);

test("section lists usable models, flags unusable variables and omits absent tiers", () => {
  const section = renderDelegationSection(
    delegationCatalog({
      MODEL_FOR_EASY_TASKS: "anthropic/model-easy",
      MODEL_FOR_MEDIUM_TASKS: "openai/model-medium",
    }),
  );
  expect(section).toContain("model-easy");
  expect(section).toContain("MODEL_FOR_MEDIUM_TASKS");
  expect(section).not.toContain("model-medium");
  expect(section).not.toContain("MODEL_FOR_HARD_TASKS");
});
