import { redact } from "./privacy.ts";

export interface SourceMessage {
  entry_id: string;
  text: string;
  speaker?: "owner" | "assistant" | "agent";
  mentioned_at?: string | null;
  source_timezone?: string | null;
  original_mail?: { message_ref: { conversation_id: string; id: string }; sender: string };
}
export interface CaptureSegment {
  blocked_reason?: "unbound-origin";
  binding?: unknown;
  project: string | null;
  messages: SourceMessage[];
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
    let original_mail: SourceMessage["original_mail"];
    let mail: Record<string, unknown> | undefined;
    if (e.type === "message") {
      const m = object(e.message);
      if (m?.role === "user" || m?.role === "assistant") {
        content = text(m.content);
        speaker = m.role === "user" ? "owner" : "assistant";
        if (!mentioned_at && typeof m.timestamp === "number" && Number.isFinite(m.timestamp))
          mentioned_at = new Date(m.timestamp).toISOString();
      } else if (m?.role === "custom" && m.customType === "agent-mail") mail = m;
    } else if (e.type === "custom_message" && e.customType === "agent-mail") {
      mail = e;
    }
    if (mail) {
      content = `[inter-bot mail] ${text(mail.content)}`;
      speaker = "agent";
      try {
        const envelope = object(JSON.parse(text(mail.content)));
        const ref = object(envelope?.message_ref);
        if (
          typeof ref?.conversation_id === "string" &&
          typeof ref.id === "string" &&
          typeof envelope?.sender === "string"
        )
          original_mail = {
            message_ref: { conversation_id: ref.conversation_id, id: ref.id },
            sender: envelope.sender,
          };
        if (
          typeof envelope?.created_at === "string" &&
          /(?:Z|[+-]\d\d:\d\d)$/.test(envelope.created_at) &&
          Number.isFinite(Date.parse(envelope.created_at))
        )
          mentioned_at = envelope.created_at;
      } catch {
        /* Legacy mail text remains attributed as an agent report. */
      }
    }
    return content.trim() && speaker
      ? [
          {
            entry_id: e.id,
            text: redact(content),
            speaker,
            mentioned_at,
            ...(original_mail ? { original_mail } : {}),
            ...(typeof e.source_timezone === "string"
              ? { source_timezone: e.source_timezone }
              : {}),
          },
        ]
      : [];
  });
}

export function splitSegments(messages: SourceMessage[], project: string | null): CaptureSegment[] {
  const segments: CaptureSegment[] = [];
  let current: SourceMessage[] = [];
  let length = 0;
  for (const message of messages) {
    for (let start = 0; start < message.text.length; start += 12000) {
      const part = message.text.slice(start, start + 12000);
      if (length + part.length > 12000) {
        segments.push({ project, messages: current });
        current = [];
        length = 0;
      }
      current.push({ ...message, text: part });
      length += part.length;
    }
  }
  if (current.length) segments.push({ project, messages: current });
  return segments;
}
