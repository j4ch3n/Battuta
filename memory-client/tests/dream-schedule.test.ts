import { afterEach, expect, test, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DREAM_PROMPT, ownedDreamTask, reconcileDreamSchedule } from "../dream-schedule.ts";
import { initializeSchedulerStore, readSchedulerStore } from "../scheduler-store.ts";

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
    schedule: "0 30 5 * * *",
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

test("old 03:00 task remains untouched and conflicts instead of being migrated", () => {
  const store = reconcileDreamSchedule({ version: 2, revision: 0, tasks: [] }, now);
  store.tasks[0] = {
    ...store.tasks[0],
    schedule: "0 0 3 * * *",
    enabled: false,
    runCount: 7,
    lastRun: now,
  };
  const before = JSON.stringify(store);
  expect(() => reconcileDreamSchedule(store, now)).toThrow("ownership conflict");
  expect(JSON.stringify(store)).toBe(before);
});
test("offline reconciliation upgrades the owned legacy prompt without enabling or resetting the task", () => {
  const store = reconcileDreamSchedule({ version: 2, revision: 0, tasks: [] }, now);
  const legacy = {
    ...store.tasks[0],
    enabled: false,
    runCount: 7,
    lastRun: now,
    prompt:
      "Call memory_dream exactly once. Report only its completion status. Do not request or repeat private dream reflections.",
  };
  const input = { ...store, tasks: [legacy] };
  expect(ownedDreamTask(legacy)).toBe(true);
  const upgraded = reconcileDreamSchedule(input, now);
  expect(upgraded.tasks).toEqual([{ ...legacy, prompt: DREAM_PROMPT }]);
  expect(upgraded.revision).toBe(input.revision + 1);
  expect(upgraded.tasks[0].prompt).not.toBe(legacy.prompt);
  expect(reconcileDreamSchedule(upgraded, now)).toEqual(upgraded);
});

function configure(dir: string, env: Record<string, string>, release = false) {
  return promisify(execFile)(
    process.execPath,
    ["configure-dream.mjs", dir, ...(release ? ["--release"] : [])],
    { env: { ...process.env, ...env } },
  );
}

test("dream setup is idempotent and preserves private preferences and directory mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-setup-"));
  dirs.push(dir);
  const store = join(dir, "stable/jobs.json");
  await initializeSchedulerStore(store);
  await chmod(join(dir, "stable"), 0o750);
  await mkdir(join(dir, ".pi"));
  const settings = JSON.stringify({
    defaultProvider: "p",
    defaultModel: "m",
    extensions: ["custom.ts"],
  });
  await writeFile(join(dir, ".pi/settings.json"), settings);
  await configure(dir, { PI_SCHEDULER_STATE_FILE: store });
  const first = await readFile(store, "utf8");
  await configure(dir, { PI_SCHEDULER_STATE_FILE: store });
  expect(await readFile(store, "utf8")).toBe(first);
  expect((await readSchedulerStore(store)).tasks.filter(ownedDreamTask)).toHaveLength(1);
  expect(await readFile(join(dir, ".pi/settings.json"), "utf8")).toBe(settings);
  expect((await stat(join(dir, "stable"))).mode & 0o777).toBe(0o750);
});

test("release dream setup preserves an existing store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-release-"));
  dirs.push(dir);
  const store = join(dir, "jobs.json");
  await initializeSchedulerStore(store);
  const before = await readFile(store, "utf8");
  const { stdout } = await configure(dir, { PI_SCHEDULER_STATE_FILE: store }, true);
  expect(await readFile(store, "utf8")).toBe(before);
  expect(JSON.parse(stdout)).toEqual([{ path: store, created: false }]);
});

test.each(["file", "parent"])("release dream setup refuses a symlinked %s", async (kind) => {
  const dir = await mkdtemp(join(tmpdir(), "dream-release-link-"));
  dirs.push(dir);
  const real = join(dir, "real");
  await mkdir(real);
  if (kind === "file") await writeFile(join(real, "jobs.json"), "private");
  const link = join(dir, "link");
  await symlink(kind === "file" ? join(real, "jobs.json") : real, link);
  const store = kind === "file" ? link : join(link, "jobs.json");
  await expect(configure(dir, { PI_SCHEDULER_STATE_FILE: store }, true)).rejects.toThrow();
  if (kind === "file") expect(await readFile(join(real, "jobs.json"), "utf8")).toBe("private");
  else await expect(stat(join(real, "jobs.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("concurrent release dream setups create the store once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-release-race-"));
  dirs.push(dir);
  const store = join(dir, "jobs.json");
  const outputs = await Promise.all(
    [1, 2].map(() => configure(dir, { PI_SCHEDULER_STATE_FILE: store }, true)),
  );
  const results = outputs.flatMap(({ stdout }) => JSON.parse(stdout) as { created: boolean }[]);
  expect(results.filter((item) => item.created)).toHaveLength(1);
  expect((await readSchedulerStore(store)).tasks).toHaveLength(1);
});

test("Pi discovers the prepared project-local dream extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-relative-"));
  dirs.push(dir);
  const agent = join(dir, "agent");
  await mkdir(join(dir, ".pi/extensions"), { recursive: true });
  await symlink(
    fileURLToPath(new URL("../dream-extension.ts", import.meta.url)),
    join(dir, ".pi/extensions/dream.ts"),
  );
  await mkdir(agent);
  await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({}));
  const store = join(dir, "jobs.json");
  vi.stubEnv("AGENT_ROLE", "cos");
  await configure(dir, { PI_CODING_AGENT_DIR: join(dir, ".pi"), PI_SCHEDULER_STATE_FILE: store });
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: agent,
    settingsManager: SettingsManager.create(dir, agent),
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions.some((extension) => extension.tools.has("memory_dream"))).toBe(true);
  expect((await readSchedulerStore(store)).tasks).toHaveLength(1);
});
