import { redact } from "./privacy.ts";

export interface SourceMessage {
  entry_id: string;
  text: string;
}
export interface CaptureSegment {
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
    if (e.type === "message") {
      const m = object(e.message);
      if (m?.role === "user" || m?.role === "assistant") content = text(m.content);
    } else if (e.type === "custom_message" && e.customType === "agent-mail") {
      content = `[inter-bot mail] ${text(e.content)}`;
    }
    return content.trim() ? [{ entry_id: e.id, text: redact(content) }] : [];
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
      current.push({ entry_id: message.entry_id, text: part });
      length += part.length;
    }
  }
  if (current.length) segments.push({ project, messages: current });
  return segments;
}
