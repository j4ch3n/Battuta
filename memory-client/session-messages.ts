import { redact } from "./privacy.ts";
import { requestBindingSchema, type RequestBinding } from "./binding.ts";

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
  binding?: RequestBinding;
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

export function boundRecentMessages(entries: readonly unknown[], binding: RequestBinding) {
  let prior: RequestBinding | undefined;
  let segment: unknown[] = [];
  const recent: SourceMessage[] = [];
  const finish = () => {
    if (
      prior?.session_id === binding.session_id &&
      prior.conversation_id === binding.conversation_id &&
      prior.origin !== "internal" &&
      !hasUnboundOrigin(segment, prior)
    )
      recent.push(...collectMessages(segment));
  };
  for (const entry of entries) {
    const e = object(entry);
    if (
      e?.type === "custom" &&
      (e.customType === "memory-request" || e.customType === "memory-request-origin")
    ) {
      finish();
      const parsed = requestBindingSchema.safeParse(
        e.customType === "memory-request" ? e.data : undefined,
      );
      prior = parsed.success ? parsed.data : undefined;
      segment = [];
    } else segment.push(entry);
  }
  finish();
  return recent.slice(-6);
}
export function hasUnboundOrigin(entries: readonly unknown[], binding: RequestBinding) {
  const start = entries.reduce((last: number, entry, index) => {
    const e = object(entry);
    return e?.type === "custom" &&
      e.customType === "memory-request" &&
      object(e.data)?.request_id === binding.request_id
      ? index
      : last;
  }, -1);
  const current = entries.slice(start + 1);
  if (
    current.some((entry) => {
      const e = object(entry);
      return (
        e?.type === "custom" &&
        e.customType === "memory-request-origin" &&
        object(e.data)?.request_id !== binding.request_id
      );
    })
  )
    return true;
  const messages = collectMessages(current);
  return (
    messages.filter((m) => m.speaker === "owner").length > (binding.origin === "owner" ? 1 : 0) ||
    messages.some(
      (m) =>
        m.speaker === "agent" &&
        (binding.origin !== "mail" ||
          !binding.mail_ref ||
          !m.original_mail ||
          m.original_mail.message_ref.conversation_id !== binding.mail_ref.conversation_id ||
          m.original_mail.message_ref.id !== binding.mail_ref.id),
    )
  );
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
