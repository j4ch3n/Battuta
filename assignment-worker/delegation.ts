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

const nonClaudeHarnesses = new Set(["codex", "opencode", "amp", "omp", "devin"]);

/**
 * Reason to block a generic `delegate` call that could start Claude Code. Claude runs must go through
 * `delegate_claude_assignment`, which uses the assignment project's folder or worktree as cwd. Calls that
 * name only other harnesses (explicitly, not `all`, and not resuming a fan-out) are allowed.
 */
export function claudeDelegationBlock(input: Record<string, unknown>): string | undefined {
  const harness = typeof input.harness === "string" ? input.harness.trim().toLowerCase() : "";
  const names = harness.split(",").map((name) => name.trim());
  const onlyOtherHarnesses = names.every((name) => nonClaudeHarnesses.has(name));
  if (harness && input.resumeFanout === undefined && onlyOtherHarnesses) return undefined;
  return "Claude Code runs must use delegate_claude_assignment: it starts Claude in the assignment project's code folder or supplied worktree. The generic delegate tool may launch Claude in the wrong directory, so it is blocked for harness claude, an omitted or all-harness call, and fan-outs that include claude. Name only codex, opencode, amp, omp or devin to use it.";
}

export function renderDelegationSection(entries: CatalogEntry[]): string {
  const lines = [
    "Claude Code delegation: call `delegate_claude_assignment` with a tier and permission for each run; do not use `delegate` for Claude.",
  ];
  for (const entry of entries)
    lines.push(
      "error" in entry
        ? `- ${entry.tier}: unavailable (${entry.error})`
        : `- ${entry.tier}: --model ${entry.model}`,
    );
  if (!entries.length) lines.push("- No model tier is configured; do not delegate.");
  lines.push(
    "Tiers are independent of the assignment's difficulty, which is only the Manager's advice; hail-mary work uses max.",
    "Claude Code permissions: readonly (plan mode) or edit (acceptEdits); never danger. Other harnesses via `delegate` keep their own modes.",
  );
  return lines.join("\n");
}
