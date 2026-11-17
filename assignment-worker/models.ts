import type { AssignmentView } from "./types.ts";

const variables = {
  easy: "MODEL_FOR_EASY_TASKS",
  medium: "MODEL_FOR_MEDIUM_TASKS",
  hard: "MODEL_FOR_HARD_TASKS",
  hail_mary: "MODEL_FOR_HAIL_MARY_TASKS",
} as const;

export type ModelChoice = { provider: string; id: string; variable: string };

/** undefined means the variable is unset, so the bot's configured default model stays. */
export function modelForDifficulty(
  env: Record<string, string | undefined>,
  difficulty: AssignmentView["difficulty"],
): ModelChoice | { error: string } | undefined {
  const variable = variables[difficulty];
  const value = env[variable]?.trim();
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1)
    return { error: `${variable} must be provider/model-id, got "${value}"` };
  return { provider: value.slice(0, slash), id: value.slice(slash + 1), variable };
}
