import { redact } from "./privacy.ts";
import { chatText } from "./voice-input.ts";

export interface SourceMessage {
  entry_id: string;
  text: string;
  speaker?: "owner" | "assistant" | "agent";
  mentioned_at?: string | null;
  source_timezone?: string | null;
  original_mail?: { message_ref: { conversation_id: string; id: string }; sender: string };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      const part = object(item);
      return part?.type === "text" && typeof part.text === "string" ? [part.text] : [];
    })
    .join("\n");
}
export function collectMessages(entries: readonly unknown[]): SourceMessage[] {
  return entries.flatMap((entry) => {
    const e = object(entry);
    if (!e || typeof e.id !== "string") return [];
    let content = "";
    let speaker: SourceMessage["speaker"];
    let mentioned_at: string | null =
      typeof e.timestamp === "string" &&
      /(?:Z|[+-]\d\d:\d\d)$/.test(e.timestamp) &&
      Number.isFinite(Date.parse(e.timestamp))
        ? e.timestamp
        : null;
    if (e.type === "message") {
      const m = object(e.message);
      if (m?.role === "user" || m?.role === "assistant") {
        content = chatText(text(m.content));
        speaker = m.role === "user" ? "owner" : "assistant";
        if (!mentioned_at && typeof m.timestamp === "number" && Number.isFinite(m.timestamp))
          mentioned_at = new Date(m.timestamp).toISOString();
      }
    }
    return content.trim() && speaker
      ? [
          {
            entry_id: e.id,
            text: redact(content),
            speaker,
            mentioned_at,
            ...(typeof e.source_timezone === "string"
              ? { source_timezone: e.source_timezone }
              : {}),
          },
        ]
      : [];
  });
}
