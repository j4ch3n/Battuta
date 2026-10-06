import type { RecordKind, Stone } from "./stone.ts";

// Global records describe non-sensitive personal/cross-project context,
// not project facts. Syntactic Stone checks are supplemented with plainly
// labelled internal context and project/schema identifiers without paths.
const internalDetail =
  /\b(?:internal (?:implementation|project|schema|infrastructure|endpoint|service|details?|host|database)|implementation details?|project[- ]specific|this project|our project|production (?:deployment|endpoint|database|hostname)|[a-z][a-z0-9]*_[a-z0-9_]+\s+(?:table|column|queue|worker|service))\b/i;

export function globalDowngradeReason(
  stone: Stone,
  kind: RecordKind,
  text: string,
): string | undefined {
  if (stone.privacy.isSensitiveForGlobalMemory(text) || internalDetail.test(text))
    return "Contains project-specific or internal details";
  if (kind === "task" || kind === "error_resolution")
    return "Tasks and implementation resolutions belong to project memory";
  return undefined;
}
