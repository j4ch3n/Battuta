import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { initializeSchedulerStore, readSchedulerStore } from "../scheduler-store.ts";
import { reconcileDreamSchedule, DREAM_PROMPT } from "../dream-schedule.ts";

const [directory, phase] = process.argv.slice(2);
process.umask(0o077);
const path = join(directory, "stable schedules/schedule-prompts.json");
process.env.PI_SCHEDULER_STATE_FILE = path;
process.env.PI_SCHEDULER_CATCHUP_MAX = "0";
const upstream = new URL(
  "../node_modules/@jl1990/pi-scheduler/extensions/scheduler/index.ts",
  import.meta.url,
).pathname;
const require = createRequire(await realpath(upstream));
const core = require("./scheduler-core.cjs");
const { createTaskStore } = require("./task-store.cjs");
const native = createTaskStore({ stateFile: path, sanitize: core.sanitizeTasks });
if (phase === "seed") {
  await initializeSchedulerStore(path);
  const initial = reconcileDreamSchedule(await readSchedulerStore(path), new Date().toISOString());
  await writeFile(path, JSON.stringify(initial));
}
assert.equal((await native.read()).tasks[0].prompt, DREAM_PROMPT);
const records = [];
async function open(name) {
  const cwd = join(directory, name);
  await mkdir(cwd);
  const loaded = await discoverAndLoadExtensions([upstream], cwd, join(cwd, ".pi"));
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.sendUserMessage = (prompt) => records.push(prompt);
  const extension = loaded.extensions[0];
  const ctx = {
    cwd,
    hasUI: false,
    isIdle: () => true,
    sessionManager: { getSessionFile: () => join(cwd, "new-session.jsonl") },
    ui: { setStatus() {}, setWidget() {}, notify() {} },
  };
  const event = async (name) => {
    for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx);
  };
  const call = async (name, input) =>
    extension.tools.get(name).definition.execute("test", input, undefined, undefined, ctx);
  await event("session_start");
  return { event, call, command: (name, args) => extension.commands.get(name).handler(args, ctx) };
}
if (phase === "seed") {
  const first = await open("release-one");
  const future = new Date(Date.now() + 5000).toISOString();
  try {
    await first.call("schedule_task", {
      action: "prompt",
      type: "once",
      schedule: future,
      prompt: "Global restart reminder",
      scope: "global",
    });
    await first.call("schedule_task", {
      action: "prompt",
      type: "once",
      schedule: future,
      prompt: "Session-only reminder",
      scope: "session",
    });
    await first.call("schedule_task", {
      action: "prompt",
      type: "once",
      schedule: future,
      prompt: "Cwd-only reminder",
      scope: "cwd",
    });
    const created = await first.call("schedule_task", {
      action: "prompt",
      type: "interval",
      schedule: "1h",
      prompt: "Editable",
      scope: "global",
    });
    const id = created.details.task.id;
    for (const action of ["disable", "enable"]) {
      const result = await first.call("manage_scheduled_task", { action, id });
      assert.equal(result.details.task.enabled, action === "enable");
    }
    await first.call("manage_scheduled_task", { action: "update", id, prompt: "Updated" });
    assert.equal((await native.read()).tasks.find((t) => t.id === id).prompt, "Updated");
    await first.call("cancel_scheduled_task", { id });
    assert.equal((await native.read()).tasks.find((t) => t.id === id).status, "cancelled");
    await first.call("manage_scheduled_task", { action: "remove", id });
    await first.command("schedule", "prompt 1h :: Command reminder");
    assert.ok((await native.read()).tasks.some((t) => t.prompt === "Command reminder"));
  } finally {
    await first.event("session_shutdown");
  }
  process.exit(0);
}
const second = await open("release-two");
try {
  const listed = await second.call("list_scheduled_tasks", { includeAll: true });
  assert.ok(listed.details.tasks.some((t) => t.prompt === "Global restart reminder"));
  assert.ok(!listed.details.tasks.some((t) => t.prompt === "Session-only reminder"));
  assert.ok(!listed.details.tasks.some((t) => t.prompt === "Cwd-only reminder"));
  assert.ok(!(await native.read()).tasks.some((t) => t.prompt === "Updated"));
  assert.ok((await native.read()).tasks.some((t) => t.prompt === "Session-only reminder"));
  const deadline = Date.now() + 7000;
  while (!records.length && Date.now() < deadline) await delay(25);
  assert.equal(records.length, 1);
  assert.ok(records[0].endsWith("Global restart reminder"));
  let task;
  do {
    task = (await readSchedulerStore(path)).tasks.find(
      (t) => t.prompt === "Global restart reminder",
    );
    if (task.status === "fired") break;
    await delay(25);
  } while (Date.now() < deadline);
  assert.equal(task.status, "fired");
  assert.ok(task.history.length > 0);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(access(join(directory, "release-two/.pi/schedule-prompts.json")));
} finally {
  await second.event("session_shutdown");
}
assert.equal(core.parseCatchUpOptions(process.env).maxFire, 0);
await writeFile(path, "broken");
await assert.rejects(native.read());
assert.equal(await readFile(path, "utf8"), "broken");
console.log("Upstream scheduler contract passed");
