import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { extractConversation, localIso, windowStart } from "../conversation-extract.ts";
import { parseArchive } from "./fake-memory.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function message(id: string, timestamp: string, role: string, content: unknown) {
  return { type: "message", id, parentId: null, timestamp, message: { role, content } };
}

async function conversation(
  dir: string,
  name: string,
  id: string,
  entries: unknown[],
  mtime: Date,
) {
  const path = join(dir, name);
  await writeFile(
    path,
    [{ type: "session", id, timestamp: "2026-11-20T00:00:00Z", cwd: dir }, ...entries]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  await utimes(path, mtime, mtime);
}

async function sessions() {
  const dir = await mkdtemp(join(tmpdir(), "extract-test-"));
  directories.push(dir);
  return dir;
}

test("extracts owner and cos text across conversations and stops at the window", async () => {
  const dir = await sessions();
  await conversation(
    dir,
    "a.jsonl",
    "conv-a",
    [
      message("old", "2026-11-24T10:00:00Z", "user", "too old"),
      message("a1", "2026-11-25T10:00:00Z", "user", "MockTest's client is Acme"),
      message("a2", "2026-11-25T10:00:05Z", "assistant", [
        { type: "text", text: "Noted." },
        { type: "thinking", thinking: "private" },
      ]),
    ],
    new Date("2026-11-25T10:00:05Z"),
  );
  await conversation(
    dir,
    "b.jsonl",
    "conv-b",
    [message("b1", "2026-11-26T08:00:00Z", "user", "Launch moved")],
    new Date("2026-11-26T08:00:00Z"),
  );
  await conversation(
    dir,
    "ancient.jsonl",
    "conv-c",
    [message("c1", "2026-10-01T08:00:00Z", "user", "ancient")],
    new Date("2026-10-01T08:00:00Z"),
  );
  const lines = parseArchive(await extractConversation(dir, new Date("2026-11-25T00:00:00Z")));
  expect(lines.map((l) => [l.entry_id, l.conversation_id, l.speaker, l.text])).toEqual([
    ["a1", "conv-a", "owner", "MockTest's client is Acme"],
    ["a2", "conv-a", "cos", "Noted."],
    ["b1", "conv-b", "owner", "Launch moved"],
  ]);
  expect(lines[0].timestamp).toMatch(/[+-]\d\d:\d\d$/);
  expect(Date.parse(lines[0].timestamp)).toBe(Date.parse("2026-11-25T10:00:00Z"));
});

test("skips tool results and injected memory context, and dedupes entries", async () => {
  const dir = await sessions();
  await conversation(
    dir,
    "a.jsonl",
    "conv-a",
    [
      message("u1", "2026-11-26T08:00:00Z", "user", "hello"),
      message("u1", "2026-11-26T08:00:00Z", "user", "hello"),
      message("t1", "2026-11-26T08:00:01Z", "toolResult", "tool output"),
      {
        type: "custom_message",
        id: "m1",
        timestamp: "2026-11-26T08:00:02Z",
        customType: "memory-context",
        content: "Memory: x",
        display: false,
      },
    ],
    new Date("2026-11-26T08:00:02Z"),
  );
  const lines = parseArchive(await extractConversation(dir, new Date("2026-11-26T00:00:00Z")));
  expect(lines.map((l) => l.entry_id)).toEqual(["u1"]);
});

test("returns nothing when the session directory does not exist", async () => {
  expect(await extractConversation(join(tmpdir(), "missing-sessions-dir"), new Date())).toBe("");
});

test.each([
  [null, new Date(2026, 10, 26, 9), new Date(2026, 10, 12)],
  ["not a date", new Date(2026, 10, 26, 9), new Date(2026, 10, 12)],
  [new Date(2026, 10, 25, 5).toISOString(), new Date(2026, 10, 26, 9), new Date(2026, 10, 25)],
])("window from last success %s", (last, now, expected) => {
  expect(windowStart(last, now)).toEqual(expected);
});

test("localIso keeps the instant and carries the local offset", () => {
  const date = new Date("2026-11-26T23:30:00Z");
  expect(Date.parse(localIso(date))).toBe(date.getTime());
});
