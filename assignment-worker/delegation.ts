const tiers = [
  { tier: "economy", variable: "MODEL_FOR_EASY_TASKS" },
  { tier: "balanced", variable: "MODEL_FOR_MEDIUM_TASKS" },
  { tier: "max", variable: "MODEL_FOR_HARD_TASKS" },
] as const;

export type Tier = (typeof tiers)[number]["tier"];
export type CatalogEntry =
  { tier: Tier; variable: string; model: string } | { tier: Tier; variable: string; error: string };

/** Claude Code models a worker may delegate to; hail-mary work also uses `max`, so its variable is not read. */
export function delegationCatalog(env: Record<string, string | undefined>): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const { tier, variable } of tiers) {
    const value = env[variable]?.trim();
    if (!value) continue;
    const slash = value.indexOf("/");
    const model = value.slice(slash + 1);
    entries.push(
      slash > 0 && value.slice(0, slash) === "anthropic" && model && !/\s/.test(model)
        ? { tier, variable, model }
        : { tier, variable, error: `${variable} must be anthropic/<model-id>` },
    );
  }
  return entries;
}

export function renderDelegationSection(entries: CatalogEntry[]): string {
  const lines = ["Claude Code delegation: choose a model tier for each `delegate` run."];
  for (const entry of entries)
    lines.push(
      "error" in entry
        ? `- ${entry.tier}: unavailable (${entry.error})`
        : `- ${entry.tier}: --model ${entry.model}`,
    );
  if (!entries.length) lines.push("- No model tier is configured; do not delegate.");
  lines.push(
    "Tiers are independent of the assignment's difficulty, which is only the Manager's advice; hail-mary work uses max.",
    "Modes: plan, research, review and security-audit are read-only; implement, docs and general edit files. Never use danger.",
    "A run starts in the background, one at a time; keep handling mail and follow-ups while it runs.",
    "To wait for a run, end your turn: its requests and result start a new turn. A shell sleep delays them until it ends, so sleep at most 60 seconds at a time and never send delegate_status alongside one.",
    "Claude's questions, permission requests and the run's result arrive as messages: answer with delegate_reply, check with delegate_status, stop with delegate_stop.",
  );
  return lines.join("\n");
}

/** The delegation prompt section; absent unless the `delegate` tool is registered, so bots without it are never told to use it. */
export function delegationPromptSection(
  toolNames: readonly string[],
  env: Record<string, string | undefined>,
): string | undefined {
  return toolNames.includes("delegate")
    ? renderDelegationSection(delegationCatalog(env))
    : undefined;
}
