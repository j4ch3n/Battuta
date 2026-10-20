import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { reconcileDreamSchedule } from "../dream-schedule.ts";

const now = "2026-10-21T12:00:00.000Z";
test("the operator setup command provisions persisted files idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-configure-"));
  try {
    await mkdir(join(dir, ".pi"));
    await writeFile(
      join(dir, ".pi/settings.json"),
      JSON.stringify({ defaultProvider: "p", defaultModel: "m" }),
    );
    const configure = () => promisify(execFile)(process.execPath, ["configure-dream.mjs", dir]);
    await configure();
    const first = await readFile(join(dir, ".pi/schedule-prompts.json"), "utf8");
    await configure();
    expect(await readFile(join(dir, ".pi/schedule-prompts.json"), "utf8")).toBe(first);
    const settings: unknown = JSON.parse(await readFile(join(dir, ".pi/settings.json"), "utf8"));
    expect(settings).toMatchObject({
      defaultProvider: "p",
      defaultModel: "m",
      extensions: [expect.stringContaining("/memory-client/dream-extension.ts")],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("provisions one isolated workdir job without changing unrelated jobs or settings", () => {
  const input = {
    version: 1,
    jobs: [{ id: "other", name: "reminder", session: "s", prompt: "Unrelated" }],
  };
  const settings = {
    defaultProvider: "openai-codex",
    defaultModel: "gpt-6.1-sol",
    extensions: ["custom.ts"],
  };
  const output = reconcileDreamSchedule(
    input,
    settings,
    "/bundle/memory-client/dream-extension.ts",
    now,
  );
  expect(output.store.jobs[0]).toEqual(input.jobs[0]);
  expect(output.store.jobs[1]).toMatchObject({
    id: "battuta-memory-dream",
    name: "nightly-memory-dream",
    type: "cron",
    schedule: "0 0 3 * * *",
    model: "openai-codex/gpt-6.1-sol",
    notify: false,
    extensions: ["/bundle/memory-client/dream-extension.ts"],
    skills: [],
    enabled: true,
  });
  expect(output.store.jobs[1]).not.toHaveProperty("session");
  expect(output.settings.extensions).toEqual([
    "custom.ts",
    "/bundle/memory-client/dream-extension.ts",
  ]);
  expect(
    reconcileDreamSchedule(
      output.store,
      output.settings,
      "/bundle/memory-client/dream-extension.ts",
      now,
    ),
  ).toEqual(output);
});

test("retains an existing model, disabled state and execution statistics", () => {
  const owned = {
    id: "battuta-memory-dream",
    name: "nightly-memory-dream",
    enabled: false,
    model: "provider/selected",
    runCount: 5,
    createdAt: now,
    session: "old",
  };
  const output = reconcileDreamSchedule(
    { version: 1, jobs: [owned] },
    {},
    "/dream-extension.ts",
    now,
  );
  expect(output.store.jobs[0]).toMatchObject({
    enabled: false,
    model: "provider/selected",
    runCount: 5,
  });
  expect(output.store.jobs[0]).not.toHaveProperty("session");
});

test.each([
  [{ version: 1, jobs: [] }, {}],
  [
    { version: 2, jobs: [] },
    { defaultProvider: "p", defaultModel: "m" },
  ],
  [
    { version: 1, jobs: [{ name: "nightly-memory-dream", id: "someone-else" }] },
    { defaultProvider: "p", defaultModel: "m" },
  ],
])("rejects ambiguous ownership or invalid configuration %#", (store, settings) => {
  expect(() => reconcileDreamSchedule(store, settings, "/dream-extension.ts", now)).toThrow();
});
