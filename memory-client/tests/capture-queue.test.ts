import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { CaptureQueue } from "../capture-queue.ts";
import { collectMessages, splitSegments } from "../session-messages.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const entry = (id: string, text: string) => ({
  id,
  type: "message",
  message: { role: "user", content: text },
});
test("filters reasoning, tools and profile context; keeps labelled incoming mail", () => {
  const entries = [
    entry("1", "hello"),
    {
      id: "2",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "answer" },
        ],
      },
    },
    { id: "3", type: "message", message: { role: "toolResult", content: "unsafe" } },
    { id: "4", type: "custom_message", customType: "agent-mail", content: "TL says use sqlite" },
  ];
  expect(collectMessages(entries).map((m) => m.text)).toEqual([
    "hello",
    "answer",
    "[inter-bot mail] TL says use sqlite",
  ]);
});
test("large messages are fully split at bounded segment sizes", () => {
  const segments = splitSegments([{ entry_id: "e", text: "x".repeat(25000) }], "atlas");
  expect(segments).toHaveLength(3);
  expect(segments.every((s) => s.messages.reduce((n, m) => n + m.text.length, 0) <= 12000)).toBe(
    true,
  );
  expect(
    segments
      .flatMap((s) => s.messages)
      .map((m) => m.text)
      .join(""),
  ).toBe("x".repeat(25000));
});
test("durable accumulator survives a crash below threshold and redacts before storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-test-"));
  dirs.push(dir);
  const queue = await CaptureQueue.open(dir, "pm");
  await queue.track("s", [entry("old", "old history")], "atlas", false);
  await queue.track(
    "s",
    [entry("old", "old history"), entry("new", "password is hunter2")],
    "atlas",
    false,
  );
  const recovered = await CaptureQueue.open(dir, "pm");
  expect(recovered.pending("s")).toHaveLength(1);
  expect(recovered.pending("s")[0].messages[0].text).not.toContain("hunter2");
  const serialized = await readFile(join(dir, "state.json"), "utf8");
  expect(serialized).not.toContain("old history");
  expect(serialized).not.toContain("hunter2");
  expect((await stat(join(dir, "state.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
});
test("flush keeps original binding and a validated batch survives reconnect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-test-"));
  dirs.push(dir);
  const queue = await CaptureQueue.open(dir, "tl");
  await queue.track("s", [], "atlas", false);
  await queue.track("s", [entry("a", "Atlas fact")], "atlas", false);
  await queue.track("s", [entry("a", "Atlas fact"), entry("b", "Beacon fact")], "beacon", true);
  const jobs = queue.jobs();
  expect(jobs.map((j) => j.segment.project)).toEqual(["atlas", "beacon"]);
  jobs[0].batch = { items: [] };
  await queue.update(jobs[0]);
  const restored = await CaptureQueue.open(dir, "tl");
  expect(restored.jobs()[0].batch).toEqual({ items: [] });
  expect(restored.jobs()[0].id).toBe(jobs[0].id);
  await restored.markUploaded(jobs[0].id);
  expect(restored.jobs().map((j) => j.id)).toEqual([jobs[1].id]);
});
