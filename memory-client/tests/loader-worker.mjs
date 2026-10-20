import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [directory, hostPiEntry] = process.argv.slice(2);
const piModule = hostPiEntry
  ? pathToFileURL(await realpath(hostPiEntry)).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const { discoverAndLoadExtensions } = await import(piModule);
const memory = join(directory, "shared-memory");
await mkdir(memory, { recursive: true });
process.env.BATTUTA_MEMORY_DATA_DIR = memory;
for (const role of ["pm", "tl"]) {
  const agent = join(directory, role);
  await mkdir(agent, { recursive: true });
  const profile = "# Owner\nPrefers concise answers.\n";
  await writeFile(join(memory, "ME.md"), profile);
  await writeFile(join(agent, "ME.md"), "Legacy private profile must not be loaded or changed.\n");
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify({ battutaMemoryCapture: { enabled: false } }),
  );
  process.env.AGENT_ROLE = role;
  process.env.PI_CODING_AGENT_DIR = agent;
  const loaded = await discoverAndLoadExtensions(
    [new URL("../index.ts", import.meta.url).pathname],
    agent,
    agent,
  );
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 0);
  let prompt;
  const ctx = {
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
  assert.equal(await readFile(join(memory, "ME.md"), "utf8"), profile);
  assert.equal(
    await readFile(join(agent, "ME.md"), "utf8"),
    "Legacy private profile must not be loaded or changed.\n",
  );
}
console.log("Pi loader read-only profile smoke passed");
