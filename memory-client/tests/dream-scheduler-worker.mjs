import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { configureDream } from "../configure-dream.mjs";
import { initializeSchedulerStore } from "../scheduler-store.ts";
import { dreamRunId } from "../dream-runtime.ts";
import { DREAM_PROMPT } from "../dream-schedule.ts";

const [directory] = process.argv.slice(2);
const agent = join(directory, ".pi");
const data = join(directory, "memory");
process.env.BATTUTA_MEMORY_DATA_DIR = data;
process.env.PI_SCHEDULER_STATE_FILE = join(directory, "schedule-prompts.json");
await initializeSchedulerStore(process.env.PI_SCHEDULER_STATE_FILE);
await mkdir(agent, { recursive: true });
await writeFile(
  join(agent, "settings.json"),
  JSON.stringify({ defaultProvider: "offline", defaultModel: "dream" }),
);
await configureDream(directory);
process.umask(0o077);
process.env.PI_SCHEDULER_CATCHUP_MAX = "1";
const persisted = JSON.parse(await readFile(process.env.PI_SCHEDULER_STATE_FILE, "utf8"));
persisted.tasks[0].nextRun = dreamRunId(new Date());
persisted.tasks[0].dueAt = persisted.tasks[0].nextRun;
await writeFile(process.env.PI_SCHEDULER_STATE_FILE, JSON.stringify(persisted));
for (const [now, due] of [
  ["2026-10-21T06:59:59Z", "2026-10-20T07:00:00.000Z"],
  ["2026-10-21T07:00:00Z", "2026-10-21T07:00:00.000Z"],
  ["2026-11-02T20:00:00Z", "2026-11-02T08:00:00.000Z"],
])
  assert.equal(dreamRunId(new Date(now)), due);
let inventoryCalls = 0;
let holdService = false;
let reachedService;
let releaseEvidence;
const evidenceGate = new Promise((resolve) => {
  releaseEvidence = resolve;
});
const server = createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (input.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (input.method === "initialize")
      result = {
        protocolVersion: input.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "offline", version: "1" },
      };
    else {
      assert.equal(input.method, "tools/call");
      const name = input.params.name;
      assert.ok(
        ["memory_inventory", "memory_global_relationships", "memory_consolidate_global"].includes(
          name,
        ),
      );
      if (holdService) {
        reachedService?.();
        return;
      }
      await evidenceGate;
      let value;
      if (name === "memory_inventory") {
        inventoryCalls++;
        value = { records: [], recent_refs: [], inactive: [], ...input.params.arguments };
      } else if (name === "memory_global_relationships")
        value = {
          status: "unavailable",
          generation_id: null,
          input_fingerprint: null,
          algorithm_fingerprint: null,
          edges: [],
          truncated: false,
        };
      else
        value = {
          status: "published",
          generation_id: "a".repeat(64),
          input_fingerprint: "b".repeat(64),
          algorithm_fingerprint: "c".repeat(64),
          input_count: 0,
          cluster_count: 0,
          edge_count: 0,
        };
      result = {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: { ok: true, data: value },
      };
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
process.env.BATTUTA_MEMORY_URL = `http://127.0.0.1:${server.address().port}/mcp`;
const publicEvents = [];
const loaded = await discoverAndLoadExtensions(
  [
    new URL("../dream-extension.ts", import.meta.url).pathname,
    new URL("../node_modules/@jl1990/pi-scheduler/extensions/scheduler/index.ts", import.meta.url)
      .pathname,
  ],
  directory,
  agent,
);
assert.deepEqual(loaded.errors, []);
loaded.runtime.appendEntry = (...args) => publicEvents.push(args);
const extension = loaded.extensions[0];
const tool = extension.tools.get("memory_dream").definition;
const scheduler = loaded.extensions[1];
let scheduled;
// Deterministic PM boundary: accept the delivered instruction and call its tool.
// Delivery alone cannot force a real PM model to choose this call.
loaded.runtime.sendUserMessage = (prompt) => {
  assert.ok(prompt.endsWith(DREAM_PROMPT));
  scheduled = tool.execute("scheduled", {}, undefined, undefined, ctx);
};
let modelCalls = 0;
const reflection = "PRIVATE dream reflection";
const ctx = {
  cwd: directory,
  hasUI: false,
  isIdle: () => true,
  model: { provider: "other", id: "conversation" },
  modelRegistry: {
    find: (provider, id) => ({ provider, id }),
    complete: async (model, input) => {
      assert.deepEqual(model, { provider: "offline", id: "dream" });
      assert.equal(input.tools, undefined);
      assert.equal(input.messages.length, 1);
      assert.ok(!JSON.stringify(input).includes("PRIVATE PM transcript"));
      modelCalls++;
      const text = input.systemPrompt.includes("Refresh the whole high-level personal profile")
        ? JSON.stringify({
            sections: Object.fromEntries(
              [
                "backgroundAndRole",
                "goalsAndPriorities",
                "valuesAndDecisionMaking",
                "lifeContextAndInterests",
                "enduringPreferencesAndConstraints",
              ].map((key) => [key, []]),
            ),
          })
        : reflection;
      return { stopReason: "stop", content: [{ type: "text", text }], usage: { totalTokens: 2 } };
    },
  },
  sessionManager: {
    getSessionFile: () => "normal-PM.jsonl",
    getBranch: () => [{ content: "PRIVATE PM transcript" }],
  },
  ui: { setStatus: (...args) => publicEvents.push(args) },
};
try {
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({}, ctx);
  for (const handler of scheduler.handlers.get("session_start") ?? []) await handler({}, ctx);
  const deadline = Date.now() + 7000;
  let history;
  do {
    history = JSON.parse(await readFile(process.env.PI_SCHEDULER_STATE_FILE, "utf8")).tasks[0]
      .history;
    if (scheduled && history?.length) break;
    await delay(25);
  } while (Date.now() < deadline);
  assert.ok(scheduled, "Scheduler catch-up delivered the native dream prompt");
  assert.equal(history[0].outcome.status, "success");
  await assert.rejects(access(join(data, "dream.log")), "Delivery is not dream completion");
  releaseEvidence();
  const result = await scheduled;
  assert.deepEqual(result.details, { status: "complete" });
  assert.ok(!JSON.stringify(result).includes(reflection));
  assert.ok(inventoryCalls > 0);
  assert.equal(JSON.parse(await readFile(join(data, "dream-state.json"), "utf8")).completed, true);
  const log = await readFile(join(data, "dream.log"), "utf8");
  assert.ok(log.includes(reflection));
  assert.ok(!JSON.stringify(publicEvents).includes(reflection));
  assert.ok(!(await readFile(join(data, "dream-usage.jsonl"), "utf8")).includes(reflection));
  const calls = modelCalls;
  await tool.execute("repeat", {}, undefined, undefined, ctx);
  assert.equal(modelCalls, calls);
  assert.equal(await readFile(join(data, "dream.log"), "utf8"), log);
  holdService = true;
  const cancelled = join(directory, "cancelled-memory");
  await mkdir(cancelled);
  await writeFile(
    join(cancelled, "dream-config.json"),
    JSON.stringify({ version: 1, model: "offline/dream" }),
  );
  process.env.BATTUTA_MEMORY_DATA_DIR = cancelled;
  const reached = new Promise((resolve) => {
    reachedService = resolve;
  });
  const abort = new AbortController();
  const pending = tool.execute("cancel", {}, abort.signal, undefined, ctx);
  const rejected = assert.rejects(pending, /Dream unavailable/);
  await reached;
  abort.abort();
  await rejected;
  await assert.rejects(access(join(cancelled, "dream.log")));
  console.log("Pinned scheduler dream isolation passed");
} finally {
  releaseEvidence();
  for (const handler of scheduler.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
  for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
  server.closeAllConnections();
  server.close();
}
