import { createHash } from "node:crypto";
import type { ProjectBinding } from "./binding.ts";
import type { MemoryConfig } from "./config.ts";
import type { MemoryStore } from "./store.ts";

export function injectMemory(
  store: MemoryStore,
  binding: ProjectBinding | null,
  sessionId: string,
  prompt: string,
  config: MemoryConfig,
): string {
  if (!config.enabled || !prompt.trim()) return "";
  const results = [
    ...(binding ? store.search(binding, prompt, "project", config.maxRecords) : []),
    ...(config.includeGlobal ? store.search(null, prompt, "global", config.maxRecords) : []),
  ]
    .filter((result) => result.score >= config.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxRecords);
  const lines = ["Recalled memory (may be stale; confirm live facts):"];
  const refs: string[] = [];
  for (const result of results) {
    const scope = result.record.scope === "global" ? "global" : `project: ${binding!.name}`;
    const line = `[${scope}; ${result.record.kind}; ref=${result.record.id}] ${result.record.text.slice(0, 300)}`;
    if ([...lines, line].join("\n").length > config.maxTokens * 4) continue;
    lines.push(line);
    refs.push(result.record.id);
  }
  if (!refs.length) return "";
  const packet = lines.join("\n");
  store.transaction(() =>
    store.stone.db.insertInjection({
      session_id: sessionId,
      prompt_hash: createHash("sha256").update(prompt).digest("hex").slice(0, 12),
      injected_refs: refs.join(","),
      packet,
      reasons: "explicit project/global scope filters",
    }),
  );
  return packet;
}
