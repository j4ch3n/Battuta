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
test.each([false, true])(
  "environment-selected dream setup preserves private preferences (separate agent dir: %s)",
  async (separate) => {
    const dir = await mkdtemp(join(tmpdir(), "dream-setup-"));
    dirs.push(dir);
    const store = join(dir, "stable/jobs.json");
    const data = join(dir, "memory");
    await initializeSchedulerStore(store);
    await chmod(join(dir, "stable"), 0o750);
    await mkdir(join(dir, ".pi"));
    await writeFile(
      join(dir, ".pi/settings.json"),
      JSON.stringify({
        ...(separate ? {} : { defaultProvider: "p", defaultModel: "m" }),
        extensions: ["custom.ts"],
      }),
    );
    const agent = join(dir, "private-agent");
    await mkdir(agent);
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({ defaultProvider: "p", defaultModel: "m" }),
    );
    const env = {
      ...process.env,
      ...(separate ? { PI_CODING_AGENT_DIR: agent } : {}),
      PI_SCHEDULER_STATE_FILE: store,
      BATTUTA_MEMORY_DATA_DIR: data,
      BATTUTA_DREAM_MODEL: "dream/first",
    };
    const configure = () =>
      promisify(execFile)(process.execPath, ["configure-dream.mjs", dir], { env });
    await configure();
    expect(JSON.parse(await readFile(join(agent, "settings.json"), "utf8"))).toEqual({
      defaultProvider: "p",
      defaultModel: "m",
    });
    expect((await stat(join(dir, "stable"))).mode & 0o777).toBe(0o750);
    const first = await readFile(store, "utf8");
    await configure();
    expect(await readFile(store, "utf8")).toBe(first);
    expect(JSON.parse(await readFile(join(data, "dream-config.json"), "utf8"))).toEqual({
      version: 1,
      model: "dream/first",
    });
    env.BATTUTA_DREAM_MODEL = "dream/second";
    await configure();
    expect(JSON.parse(await readFile(join(data, "dream-config.json"), "utf8"))).toEqual({
      version: 1,
      model: "dream/second",
    });
    expect(await readFile(store, "utf8")).toBe(first);
    const { extensions } = JSON.parse(await readFile(join(dir, ".pi/settings.json"), "utf8")) as {
      extensions: string[];
    };
    expect(extensions).toEqual(["custom.ts"]);
    await expect(readFile(join(dir, ".pi/schedule-prompts.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
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
  await promisify(execFile)(process.execPath, ["configure-dream.mjs", dir], {
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: join(dir, ".pi"),
      PI_SCHEDULER_STATE_FILE: store,
      BATTUTA_MEMORY_DATA_DIR: join(dir, "memory"),
      BATTUTA_DREAM_MODEL: "dream/explicit",
    },
  });
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
test.each(
  [undefined, "", " ", "missing-provider", "p/model with spaces"].flatMap((model) =>
    [false, true].flatMap((saved) =>
      [false, true].map((storeExists) => ({ model, saved, storeExists })),
    ),
  ),
)(
  "invalid dream environment $model leaves state unchanged (saved config: $saved, store: $storeExists)",
  async ({ model, saved, storeExists }) => {
    const dir = await mkdtemp(join(tmpdir(), "dream-unconfigured-"));
    dirs.push(dir);
    const store = join(dir, "stable/jobs.json");
    if (storeExists) await initializeSchedulerStore(store);
    await mkdir(join(dir, ".pi"));
    const settingsText = JSON.stringify({ defaultProvider: "p", defaultModel: "m" });
    await writeFile(join(dir, ".pi/settings.json"), settingsText);
    const data = join(dir, "memory");
    const modelPath = join(data, "dream-config.json");
    const modelText = JSON.stringify({ version: 1, model: "dream/saved" });
    if (saved) {
      await mkdir(data);
      await writeFile(modelPath, modelText);
    }
    const env = { ...process.env };
    delete env.BATTUTA_DREAM_MODEL;
    if (model !== undefined) env.BATTUTA_DREAM_MODEL = model;
    const before = storeExists ? await readFile(store, "utf8") : undefined;
    await expect(
      promisify(execFile)(process.execPath, ["configure-dream.mjs", dir], {
        env: {
          ...env,
          PI_SCHEDULER_STATE_FILE: store,
          BATTUTA_MEMORY_DATA_DIR: data,
        },
      }),
    ).rejects.toThrow();
    if (storeExists) expect(await readFile(store, "utf8")).toBe(before);
    else await expect(stat(join(dir, "stable"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dir, ".pi/settings.json"), "utf8")).toBe(settingsText);
    if (saved) expect(await readFile(modelPath, "utf8")).toBe(modelText);
    else await expect(readFile(modelPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
