import { expect, test } from "vitest";
import { modelForDifficulty } from "../models.ts";

test.each([
  ["easy", "MODEL_FOR_EASY_TASKS"],
  ["medium", "MODEL_FOR_MEDIUM_TASKS"],
  ["hard", "MODEL_FOR_HARD_TASKS"],
  ["hail_mary", "MODEL_FOR_HAIL_MARY_TASKS"],
] as const)("%s reads %s and splits provider from model id", (difficulty, variable) => {
  expect(modelForDifficulty({ [variable]: "openai/gpt-x" }, difficulty)).toEqual({
    provider: "openai",
    id: "gpt-x",
    variable,
  });
  expect(modelForDifficulty({ [variable]: "router/vendor/model" }, difficulty)).toMatchObject({
    provider: "router",
    id: "vendor/model",
  });
});

test.each([undefined, "", "  "])("unset value %j keeps the configured default", (value) => {
  expect(modelForDifficulty({ MODEL_FOR_EASY_TASKS: value }, "easy")).toBeUndefined();
});

test.each(["gpt-x", "/gpt-x", "openai/"])("malformed value %j names the variable", (value) => {
  const result = modelForDifficulty({ MODEL_FOR_HARD_TASKS: value }, "hard");
  expect(result && "error" in result ? result.error : "").toContain("MODEL_FOR_HARD_TASKS");
});
