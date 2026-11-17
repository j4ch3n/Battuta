import { collectMessages } from "./session-messages.ts";
import { redact } from "./privacy.ts";

const RECALL_QUERY_MESSAGES = 3;

export function selectRecallQuery(entries: readonly unknown[], current: string): string {
  const owner = collectMessages(
    entries.filter((value) => {
      const entry = value as { type?: string; message?: { role?: string } } | null;
      return entry?.type === "message" && entry.message?.role === "user";
    }),
  )
    .filter((m) => m.speaker === "owner")
    .map((m) => redact(m.text))
    .reverse();
  const latest = redact(current);
  const messages = (owner[0] === latest ? owner : [latest, ...owner]).filter((text) => text.trim());
  return messages.slice(0, RECALL_QUERY_MESSAGES).join("\n\n") || "recent owner context";
}
