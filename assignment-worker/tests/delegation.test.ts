import { expect, test } from "vitest";
import {
  claudeDelegationBlock,
  claudeDelegationRedirect,
  delegationCatalog,
  renderDelegationSection,
} from "../delegation.ts";

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

test.each(["openai/gpt-x", "gpt-x", "anthropic/", "/gpt-x", "anthropic/claude haiku"])(
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

test.each([
  { harness: "codex", task: "x" },
  { harness: "opencode,amp" },
  { harness: " Devin " },
  { harness: "omp" },
])("the generic delegate tool may run non-Claude harnesses: %j", (input) => {
  expect(claudeDelegationBlock(input)).toBeUndefined();
});

test.each([
  ["no harness", {}],
  ["an empty harness", { harness: "" }],
  ["claude", { harness: "claude" }],
  ["claude in different case", { harness: "Claude" }],
  ["all harnesses", { harness: "all" }],
  ["a fan-out that includes claude", { harness: "codex,claude" }],
  ["a trailing empty entry", { harness: "codex," }],
  ["a non-string harness", { harness: 3 }],
  ["a fan-out resume", { harness: "codex", resumeFanout: "fan_1" }],
])(
  "the generic delegate tool is blocked for %s with a pointer to the Claude tool",
  (_label, input) => {
    expect(claudeDelegationBlock(input)).toContain("delegate_claude_assignment");
  },
);

test("the delegation section keeps the mode guidance for the non-Claude harnesses", () => {
  const section = renderDelegationSection(
    delegationCatalog({ MODEL_FOR_EASY_TASKS: "anthropic/model-easy" }),
  );
  expect(section).toContain(
    "Modes: plan, research, review and security-audit are read-only; implement, docs and general edit files. Never use danger.",
  );
  expect(section).toContain("readonly (plan mode) or edit (acceptEdits); never danger.");
});

test("a blocked generic call gets the shared redirect message", () => {
  expect(claudeDelegationBlock({ harness: "claude" })).toBe(claudeDelegationRedirect);
});
