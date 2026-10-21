import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { initializeSchedulerStore } from "../scheduler-store.ts";
import { configureDream } from "../configure-dream.mjs";
import { DREAM_PROMPT } from "../dream-schedule.ts";

const [directory, phase] = process.argv.slice(2);
const store = join(directory, "stable schedules/schedule-prompts.json");
process.env.PI_SCHEDULER_STATE_FILE = store;
process.env.BATTUTA_MEMORY_DATA_DIR = join(directory, "memory");
if (phase === "seed") {
  const workspace = join(directory, "release-one");
  await mkdir(join(workspace, ".pi"), { recursive: true });
  await writeFile(
    join(workspace, ".pi/settings.json"),
    JSON.stringify({ defaultProvider: "offline", defaultModel: "dream" }),
  );
  await initializeSchedulerStore(store);
  await configureDream(workspace);
  // Make the provisioned task due without waiting for local 03:00.
  const saved = JSON.parse(await readFile(store, "utf8"));
  saved.tasks[0].nextRun = new Date(Date.now() - 1000).toISOString();
  saved.tasks[0].dueAt = saved.tasks[0].nextRun;
  await writeFile(store, JSON.stringify(saved));
} else {
  process.env.PI_SCHEDULER_CATCHUP_MAX = "1";
  const cwd = join(directory, "release-two");
  await mkdir(cwd);
  const loaded = await discoverAndLoadExtensions(
    [
      new URL("../node_modules/@jl1990/pi-scheduler/extensions/scheduler/index.ts", import.meta.url)
        .pathname,
    ],
    cwd,
    join(cwd, ".pi"),
  );
  assert.deepEqual(loaded.errors, []);
  let deliver;
  const delivered = new Promise((resolve) => {
    deliver = resolve;
  });
  loaded.runtime.sendUserMessage = deliver;
  const extension = loaded.extensions[0];
  const ctx = {
    cwd,
    hasUI: false,
    isIdle: () => true,
    sessionManager: { getSessionFile: () => join(cwd, "different-session.jsonl") },
  };
  try {
    for (const handler of extension.handlers.get("session_start") ?? []) await handler({}, ctx);
    assert.ok((await delivered).endsWith(DREAM_PROMPT));
    await assert.rejects(access(join(cwd, ".pi/schedule-prompts.json")));
  } finally {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
  }
  console.log("Stable dream scheduler wiring passed");
}
