import type { SessionEntry, Stone } from "./stone.ts";

// Stone handles token formats and assignments; add conversational labels before
// history is truncated, including strings nested in thinking and tool content.
const conversationalCredential =
  /\b(?:password|passwd|pwd|api[ _-]?key|api[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|client[ _-]?secret|private[ _-]?key|secret[ _-]?key|token)['"]?\s*(?:(?:is(?: set to)?|was(?: set to)?|equals)\s+|[=:]\s*)[^\r\n]+/gi;
const credentialField =
  /^(?:password|passwd|pwd|api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|token)$/i;

export function redactMemoryText(stone: Stone, text: string): string {
  return stone.privacy
    .redactSecrets(text)
    .replace(conversationalCredential, "[REDACTED:credential]");
}

export function requireSafeMemory(stone: Stone, text: string): void {
  if (redactMemoryText(stone, text) !== text)
    throw new Error("Secrets and credentials must not be stored as durable memory");
}

export function redactHistoryEntry(stone: Stone, entry: SessionEntry): SessionEntry {
  function scrub(value: unknown): unknown {
    if (typeof value === "string") return redactMemoryText(stone, value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, content]) => [
          key,
          credentialField.test(key) ? "[REDACTED:credential]" : scrub(content),
        ]),
      );
    return value;
  }
  return scrub(entry) as SessionEntry;
}
