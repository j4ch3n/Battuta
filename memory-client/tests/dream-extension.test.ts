import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runDream } from "../dream-extension.ts";
import { fakeMemory, parseArchive } from "./fake-memory.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const noSleep = async () => {};

async function sessionDir(withMessage: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "dream-test-"));
  directories.push(dir);
  if (withMessage)
    await writeFile(
      join(dir, "a.jsonl"),
      [
        { type: "session", id: "conv", timestamp: new Date().toISOString(), cwd: dir },
        {
          type: "message",
          id: "u1",
          timestamp: new Date().toISOString(),
          message: { role: "user", content: "MockTest's client is Acme" },
        },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
  return dir;
}

function statuses(...states: object[]) {
  return () => (states.length > 1 ? states.shift() : states[0]);
}

test("uploads, starts and reports the finished dream", async () => {
  const { client, calls, uploads } = fakeMemory({
    memory_dream_status: statuses(
      { status: "idle" },
      { status: "running", step: "distill" },
      {
        status: "succeeded",
        report: {
          distill: { "cos-2026-11-26": { batches: [{ written: ["a", "b"] }] } },
          overviews: ["mocktest"],
        },
      },
    ),
    memory_dream_start: { status: "started" },
  });
  const result = await runDream(client, {
    sessionDir: await sessionDir(true),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  expect(calls.map(([name]) => name)).toEqual([
    "memory_dream_status",
    "memory_dream_start",
    "memory_dream_status",
    "memory_dream_status",
  ]);
  expect(parseArchive(uploads[0]).map((line) => line.entry_id)).toEqual(["u1"]);
  expect(result).toMatchObject({
    status: "succeeded",
    memories_written: 2,
    overviews_refreshed: ["mocktest"],
  });
});

test("skips the upload when there is nothing new but still dreams", async () => {
  const { client, uploads } = fakeMemory({
    memory_dream_status: statuses(
      { status: "idle", last_success_at: new Date().toISOString() },
      { status: "succeeded", report: {} },
    ),
    memory_dream_start: { status: "started" },
  });
  const result = await runDream(client, {
    sessionDir: await sessionDir(false),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  expect(uploads).toEqual([]);
  expect(result.status).toBe("succeeded");
});

test("reports a dream that is already running without uploading", async () => {
  const { client, uploads, calls } = fakeMemory({
    memory_dream_status: { status: "running", step: "consolidate" },
  });
  expect(
    await runDream(client, {
      sessionDir: await sessionDir(true),
      signal: new AbortController().signal,
      sleep: noSleep,
    }),
  ).toEqual({
    status: "already_running",
    step: "consolidate",
  });
  expect(uploads).toEqual([]);
  expect(calls.map(([name]) => name)).toEqual(["memory_dream_status"]);
});

test("reports a failed dream with its step", async () => {
  const { client } = fakeMemory({
    memory_dream_status: statuses(
      { status: "idle" },
      { status: "failed", step: "distill", error: "ReasonerUnavailableError: claude" },
    ),
    memory_dream_start: { status: "started" },
  });
  const result = await runDream(client, {
    sessionDir: await sessionDir(false),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  expect(result).toMatchObject({
    status: "failed",
    step: "distill",
    error: "ReasonerUnavailableError: claude",
  });
});
