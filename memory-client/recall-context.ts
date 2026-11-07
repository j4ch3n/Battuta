import { collectMessages } from "./session-messages.ts";
import { redact } from "./privacy.ts";

export interface RecallInput {
  summary?: string;
  history: { role: "user" | "assistant"; text: string }[];
  current: string;
}

export function selectRecallInput(entries: readonly unknown[], current: string): RecallInput {
  let summary: string | undefined;
  const conversation = entries.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const entry = value as { type?: string; summary?: unknown; message?: { role?: string } };
    if (entry.type === "compaction" && typeof entry.summary === "string") summary = redact(entry.summary);
    return entry.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant");
  });
  const history = collectMessages(conversation).slice(-10).map((m) => ({
    role: m.speaker === "owner" ? "user" as const : "assistant" as const, text: m.text,
  }));
  return { ...(summary !== undefined ? { summary } : {}), history, current: redact(current) };
}
