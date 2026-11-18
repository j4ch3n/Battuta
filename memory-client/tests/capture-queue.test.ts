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
test("filters reasoning, tools and profile context; excludes agent mail", () => {
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
    {
      id: "4",
      type: "custom_message",
      customType: "agent-mail",
      content: "Manager says use sqlite",
    },
  ];
  expect(collectMessages(entries).map((m) => m.text)).toEqual(["hello", "answer"]);
});
test("large messages are fully split at bounded segment sizes", () => {
  const segments = splitSegments([{ entry_id: "e", text: "x".repeat(25000) }]);
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

test.each([
  ["transcript only", "[telegram] hi\nbuy milk", "[telegram] hi\nbuy milk"],
  ["attachment listing", "note\n[attachments] /d\n- /a.jpg\n- /b.pdf\nafter", "note\nafter"],
  ["failed transcription", "[voice message could not be transcribed: no speech was detected]", ""],
])("owner text keeps the chat only: %s", (_name, text, expected) => {
  expect(collectMessages([entry("1", text)]).map((m) => m.text)).toEqual(
    expected ? [expected] : [],
  );
});
test("collection preserves speaker and time", () => {
  const messages = collectMessages([
    { ...entry("owner", "Monday call"), timestamp: "2026-11-06T10:00:00+08:00" },
  ]);
  expect(messages[0].speaker).toBe("owner");
  expect(messages[0].mentioned_at).toBe("2026-11-06T10:00:00+08:00");
});
test("durable accumulator survives a crash below threshold and redacts before storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-test-"));
  dirs.push(dir);
  const queue = await CaptureQueue.open(dir, "cos");
  await queue.track("s", [entry("old", "old history")], false);
  await queue.track("s", [entry("old", "old history"), entry("new", "password is hunter2")], false);
  const recovered = await CaptureQueue.open(dir, "cos");
  expect(recovered.pending("s")).toHaveLength(1);
  expect(recovered.pending("s")[0].messages[0].text).not.toContain("hunter2");
  const serialized = await readFile(join(dir, "state.json"), "utf8");
  expect(serialized).not.toContain("old history");
  expect(serialized).not.toContain("hunter2");
  expect((await stat(join(dir, "state.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
});
test("mixed-project conversation stays neutral and a validated batch survives reconnect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-test-"));
  dirs.push(dir);
  const queue = await CaptureQueue.open(dir, "manager");
  await queue.track("s", [], false);
  await queue.track("s", [entry("a", "Atlas fact")], false);
  await queue.track("s", [entry("a", "Atlas fact"), entry("b", "Beacon fact")], true);
  const jobs = queue.jobs();
  expect(jobs).toHaveLength(1);
  expect(Object.keys(jobs[0].segment)).toEqual(["messages"]);
  expect(jobs[0].segment.messages.map((m) => m.text)).toEqual(["Atlas fact", "Beacon fact"]);
  jobs[0].batch = { items: [] };
  await queue.update(jobs[0]);
  const restored = await CaptureQueue.open(dir, "manager");
  expect(restored.jobs()[0].batch).toEqual({ items: [] });
  expect(restored.jobs()[0].id).toBe(jobs[0].id);
  await restored.markUploaded(jobs[0].id);
  expect(restored.jobs()).toEqual([]);
});

test("settlement racing with extraction persistence loses neither the turn nor its frozen batch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-race-"));
  dirs.push(dir);
  const queue = await CaptureQueue.open(dir, "cos");
  await queue.track("s", [], false);
  await queue.track("s", [entry("a", "First fact")], true);
  const job = queue.jobs()[0];
  job.batch = { items: ["frozen"] };
  await Promise.all([
    queue.track("s", [entry("a", "First fact"), entry("b", "Correction")], false),
    queue.update(job),
  ]);
  const restored = await CaptureQueue.open(dir, "cos");
  expect(restored.pending("s")[0].messages[0].entry_id).toBe("b");
  expect(restored.jobs()[0].batch).toEqual({ items: ["frozen"] });
});
