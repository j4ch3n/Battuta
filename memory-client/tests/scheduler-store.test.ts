import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeSchedulerStore, readSchedulerStore } from "../scheduler-store.ts";

const dirs: string[] = [];
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
  "null",
  '{"version":1,"jobs":[]}',
  '{"version":2,"revision":-1,"tasks":[]}',
  JSON.stringify({ version: 2, revision: 0, tasks: [{ id: "x", action: "prompt" }] }),
  JSON.stringify({ version: 2, revision: 0, tasks: [1] }),
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
test("directory and invalid parent write failures propagate", async () => {
  const path = await fixture();
  await initializeSchedulerStore(path);
  await expect(readSchedulerStore(join(path, ".."))).rejects.toThrow();
  await expect(initializeSchedulerStore(join(path, "child"))).rejects.toThrow();
});
