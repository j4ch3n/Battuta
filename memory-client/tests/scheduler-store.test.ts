import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeSchedulerStore, readSchedulerStore } from "../scheduler-store.ts";

const dirs: string[] = [];
afterEach(() => vi.useRealTimers());
afterEach(async () =>
  Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))),
);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-store-"));
  dirs.push(dir);
  return join(dir, "private", "jobs.json");
}
test("explicit initialization is private and preserves an existing native store byte-for-byte", async () => {
  const path = await fixture();
  await expect(readSchedulerStore(path)).rejects.toMatchObject({ code: "ENOENT" });
  await initializeSchedulerStore(path);
  expect(await readSchedulerStore(path)).toEqual({ version: 2, revision: 0, tasks: [] });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
  const text = JSON.stringify({
    version: 2,
    revision: 7,
    extra: "keep",
    tasks: [
      {
        id: "one",
        action: "prompt",
        type: "interval",
        schedule: "5m",
        scope: "global",
        status: "pending",
        enabled: true,
        prompt: "Hello",
        custom: { keep: true },
      },
    ],
  });
  await writeFile(path, text);
  await initializeSchedulerStore(path);
  expect(await readFile(path, "utf8")).toBe(text);
});
test.each([
  "broken",
  '{"version":3,"revision":0,"tasks":[]}',
  '{"version":2,"revision":0,"tasks":[1]}',
])("invalid store is not replaced: %s", async (text) => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  await writeFile(path, text);
  await expect(initializeSchedulerStore(path)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(text);
});
test("duplicate task IDs are diagnosed", async () => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  const task = {
    id: "x",
    action: "notify",
    type: "once",
    schedule: "+5m",
    message: "Hi",
    scope: "global",
    enabled: true,
    status: "pending",
  };
  await writeFile(path, JSON.stringify({ version: 2, revision: 0, tasks: [task, task] }));
  await expect(readSchedulerStore(path)).rejects.toThrow("Duplicate");
});
test("rejects a missing prompt without replacing the store", async () => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  const text = JSON.stringify({
    version: 2,
    revision: 0,
    tasks: [
      {
        id: "x",
        action: "prompt",
        type: "once",
        schedule: "5m",
        scope: "global",
        status: "pending",
        enabled: true,
      },
    ],
  });
  await writeFile(path, text);
  await expect(readSchedulerStore(path)).rejects.toThrow("Missing");
  expect(await readFile(path, "utf8")).toBe(text);
});
test("directory and invalid parent write failures propagate", async () => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  await expect(readSchedulerStore(join(path, ".."))).rejects.toThrow();
  await expect(initializeSchedulerStore(join(path, "child"))).rejects.toThrow();
});
test.each([
  { type: "cron", schedule: "not-a-cron" },
  { maxRuns: -1 },
  { expiresAt: "yesterday" },
  { scope: "session" },
  { backoff: { factor: 0, maxInterval: "5m" } },
])("preflight preserves invalid native record %j", async (fields) => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  const task = {
    id: "x",
    action: "prompt",
    type: "interval",
    schedule: "5m",
    scope: "global",
    status: "pending",
    enabled: true,
    prompt: "Keep me",
    ...fields,
  };
  const text = JSON.stringify({ version: 2, revision: 0, tasks: [task] });
  await writeFile(path, text);
  await expect(initializeSchedulerStore(path)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(text);
});
test.each(["2026-01-01T15:00:00Z", "today at 11pm"])(
  "keeps completed one-shot schedule %s valid on later startups",
  async (schedule) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 3, 23, 59));
    const path = await fixture();
    await initializeSchedulerStore(path);
    const task = {
      id: "past",
      action: "prompt",
      type: "once",
      schedule,
      scope: "global",
      status: "fired",
      enabled: false,
      prompt: "Done",
      createdAt: "2026-01-01T00:00:00.000Z",
      dueAt: "2026-01-01T15:00:00.000Z",
    };
    const text = JSON.stringify({ version: 2, revision: 1, tasks: [task] });
    await writeFile(path, text);
    await initializeSchedulerStore(path);
    expect(await readFile(path, "utf8")).toBe(text);
  },
);
