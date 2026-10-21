import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [directory, hostPiEntry, schedulerEntry] = process.argv.slice(2);
const piModule = hostPiEntry
  ? pathToFileURL(await realpath(hostPiEntry)).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const { discoverAndLoadExtensions } = await import(piModule);
const memory = join(directory, "shared-memory");
await mkdir(memory, { recursive: true });
process.env.BATTUTA_MEMORY_DATA_DIR = memory;
process.env.PI_SCHEDULER_STATE_FILE = join(memory, "scheduler.json");
process.env.PI_SCHEDULER_CATCHUP_MAX = "0";
await writeFile(
  process.env.PI_SCHEDULER_STATE_FILE,
  JSON.stringify({ version: 2, revision: 0, tasks: [] }),
);
for (const role of ["pm", "tl"]) {
  const agent = join(directory, role);
  await mkdir(agent, { recursive: true });
  const profile = "# Owner\nPrefers concise answers.\n";
  await writeFile(join(memory, "ME.md"), profile);
  await writeFile(join(agent, "ME.md"), "Legacy private profile must not be loaded or changed.\n");
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify(role === "pm" ? { battutaMemoryCapture: { enabled: false } } : {}),
  );
  process.env.AGENT_ROLE = role;
  process.env.PI_CODING_AGENT_DIR = agent;
  const loaded = await discoverAndLoadExtensions(
    [
      new URL("../index.ts", import.meta.url).pathname,
      ...(role === "pm" && schedulerEntry ? [schedulerEntry] : []),
    ],
    agent,
    agent,
  );
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 0);
  let prompt;
  const ctx = {
    cwd: agent,
    hasUI: false,
    isIdle: () => true,
    sessionManager: { getSessionId: () => "smoke", getBranch: () => [] },
    ui: { notify: () => {}, setStatus: () => {} },
    modelRegistry: {
      complete: () => {
        throw new Error("Profile must never call an LLM");
      },
    },
  };
  for (const handler of extension.handlers.get("before_agent_start") ?? []) {
    const result = await handler({ systemPrompt: "Original prompt" }, ctx);
    if (result?.systemPrompt) prompt = result.systemPrompt;
  }
  if (role === "pm") assert.ok(prompt?.includes(profile));
  else assert.equal(prompt, undefined);
  for (const event of [
    "session_start",
    "agent_settled",
    "session_before_switch",
    "session_before_fork",
    "session_before_compact",
    "session_shutdown",
  ]) {
    for (const loadedExtension of loaded.extensions)
      for (const handler of loadedExtension.handlers.get(event) ?? []) await handler({}, ctx);
  }
  await assert.rejects(access(join(memory, "capture-queue", role)), { code: "ENOENT" });
  assert.equal(await readFile(join(memory, "ME.md"), "utf8"), profile);
  assert.equal(
    await readFile(join(agent, "ME.md"), "utf8"),
    "Legacy private profile must not be loaded or changed.\n",
  );
}
console.log("Pi loader read-only profile smoke passed");
