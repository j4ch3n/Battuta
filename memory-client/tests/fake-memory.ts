import { vi } from "vitest";
import type { MemoryApi } from "../mcp-client.ts";

type Reply = unknown;

export function fakeMemory(replies: Record<string, Reply>) {
  const calls: [string, Record<string, unknown>][] = [];
  const uploads: string[] = [];
  const client: MemoryApi = {
    call: vi.fn((name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      const reply = replies[name];
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(typeof reply === "function" ? (reply as () => unknown)() : reply);
    }),
    uploadArchive: vi.fn((ndjson: string) => {
      uploads.push(ndjson);
      return Promise.resolve({
        days: { "cos-2026-11-26": { received: 1, appended: 1, duplicates: 0 } },
      });
    }),
  };
  return { client, calls, uploads };
}

export interface ArchiveLine {
  entry_id: string;
  conversation_id: string;
  speaker: string;
  text: string;
  timestamp: string;
}

export function parseArchive(ndjson: string): ArchiveLine[] {
  return ndjson
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ArchiveLine);
}
