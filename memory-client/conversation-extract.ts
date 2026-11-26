import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { collectMessages } from "./session-messages.ts";

const FIRST_WINDOW_DAYS = 14;

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Last successful dream rounded down to local midnight; the overlap is deliberate and deduped by the server. */
export function windowStart(lastSuccess: string | null | undefined, now = new Date()): Date {
  const last = lastSuccess ? new Date(lastSuccess) : undefined;
  if (last && Number.isFinite(last.getTime())) return localMidnight(last);
  const start = new Date(now);
  start.setDate(start.getDate() - FIRST_WINDOW_DAYS);
  return localMidnight(start);
}

/** ISO 8601 in the host's local offset, so the server files each message under its local day. */
export function localIso(date: Date): string {
  const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

interface ArchiveLine {
  entry_id: string;
  conversation_id: string;
  speaker: "owner" | "cos";
  text: string;
  timestamp: string;
}

function entryTime(entry: unknown): number {
  const value = (entry as { timestamp?: unknown } | null)?.timestamp;
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/** Owner and CoS messages of every persistent conversation since `since`, as NDJSON. */
export async function extractConversation(sessionDir: string, since: Date): Promise<string> {
  let names: string[];
  try {
    names = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
  const files = await Promise.all(
    names.map(async (name) => ({
      path: join(sessionDir, name),
      mtime: (await stat(join(sessionDir, name))).mtimeMs,
    })),
  );
  const lines = new Map<string, ArchiveLine>();
  for (const file of files.sort((a, b) => b.mtime - a.mtime)) {
    // Newest first: once a whole conversation predates the window, every older one does too.
    if (file.mtime < since.getTime()) break;
    const records = (await readFile(file.path, "utf8"))
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
    const header = records.find((record) => (record as { type?: string })?.type === "session") as
      { id?: string } | undefined;
    const recent: unknown[] = [];
    for (const entry of records.slice().reverse()) {
      if ((entry as { type?: string })?.type !== "message") continue;
      if (entryTime(entry) < since.getTime()) break;
      recent.push(entry);
    }
    for (const message of collectMessages(recent)) {
      const at = message.mentioned_at ? new Date(message.mentioned_at) : undefined;
      if (!at || !Number.isFinite(at.getTime()) || lines.has(message.entry_id)) continue;
      lines.set(message.entry_id, {
        entry_id: message.entry_id,
        conversation_id: header?.id ?? file.path,
        speaker: message.speaker === "owner" ? "owner" : "cos",
        text: message.text,
        timestamp: localIso(at),
      });
    }
  }
  return [...lines.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((line) => JSON.stringify(line) + "\n")
    .join("");
}
