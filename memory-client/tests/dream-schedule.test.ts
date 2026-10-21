import { afterEach, expect, test, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { reconcileDreamSchedule } from "../dream-schedule.ts";
import { initializeSchedulerStore } from "../scheduler-store.ts";

const now = "2026-10-21T12:00:00.000Z";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
test("provisions one native global dream prompt without release paths or unrelated mutations", () => {
  const other = {
    id: "other",
    action: "notify" as const,
    type: "once" as const,
    schedule: "+5m",
    message: "Hello",
    scope: "session" as const,
    status: "pending" as const,
    enabled: true,
    sessionFile: "/session",
  };
  const store = { version: 2 as const, revision: 4, tasks: [other] };
  const output = reconcileDreamSchedule(store, now);
  expect(output.tasks[0]).toEqual(other);
  expect(output.tasks[1]).toMatchObject({
    id: "battuta-memory-dream",
    action: "prompt",
    type: "cron",
    schedule: "0 0 3 * * *",
    scope: "global",
    enabled: true,
  });
  expect(output.tasks[1]).not.toHaveProperty("extensions");
  expect(output.tasks[1]).not.toHaveProperty("cwd");
  expect(reconcileDreamSchedule(output, now)).toEqual(output);
  output.tasks[1].enabled = false;
  expect(reconcileDreamSchedule(output, now).tasks[1].enabled).toBe(false);
});
test("rejects conflicting dream ownership", () => {
  expect(() =>
    reconcileDreamSchedule(
      {
        version: 2,
        revision: 0,
        tasks: [
          {
            id: "other",
            name: "nightly-memory-dream",
            action: "prompt",
            type: "cron",
            schedule: "0 0 3 * * *",
            scope: "global",
            enabled: true,
            status: "pending",
            prompt: "Other",
          },
        ],
      },
      now,
    ),
  ).toThrow("ownership");
});
test("explicit offline setup writes stable model/job config idempotently and refreshes registration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-setup-"));
  dirs.push(dir);
  const store = join(dir, "stable/jobs.json");
  const data = join(dir, "memory");
  await initializeSchedulerStore(store);
  await chmod(join(dir, "stable"), 0o750);
  await mkdir(join(dir, ".pi"));
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({ defaultProvider: "p", defaultModel: "m", extensions: ["custom.ts"] }),
  );
  const env = { ...process.env, PI_SCHEDULER_STATE_FILE: store, BATTUTA_MEMORY_DATA_DIR: data };
  const configure = () =>
    promisify(execFile)(process.execPath, ["configure-dream.mjs", dir], { env });
  await configure();
  expect((await stat(join(dir, "stable"))).mode & 0o777).toBe(0o750);
  const first = await readFile(store, "utf8");
  await configure();
  expect(await readFile(store, "utf8")).toBe(first);
  expect(JSON.parse(await readFile(join(data, "dream-config.json"), "utf8"))).toEqual({
    version: 1,
    model: "p/m",
  });
  expect(JSON.parse(await readFile(join(dir, ".pi/settings.json"), "utf8"))).toMatchObject({
    extensions: ["custom.ts", expect.stringContaining("dream-extension.ts")],
  });
  await expect(readFile(join(dir, ".pi/schedule-prompts.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
test.each([{}, { defaultProvider: "p", defaultModel: "model with spaces" }])(
  "invalid defaults %j leave scheduler and settings unchanged",
  async (settings) => {
    const dir = await mkdtemp(join(tmpdir(), "dream-unconfigured-"));
    dirs.push(dir);
    const store = join(dir, "stable/jobs.json");
    await initializeSchedulerStore(store);
    await mkdir(join(dir, ".pi"));
    const settingsText = JSON.stringify(settings);
    await writeFile(join(dir, ".pi/settings.json"), settingsText);
    const before = await readFile(store, "utf8");
    await expect(
      promisify(execFile)(process.execPath, ["configure-dream.mjs", dir], {
        env: {
          ...process.env,
          PI_SCHEDULER_STATE_FILE: store,
          BATTUTA_MEMORY_DATA_DIR: join(dir, "memory"),
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(store, "utf8")).toBe(before);
    expect(await readFile(join(dir, ".pi/settings.json"), "utf8")).toBe(settingsText);
  },
);
