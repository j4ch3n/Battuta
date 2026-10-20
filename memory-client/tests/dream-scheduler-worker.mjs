import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, readdir, access, realpath } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { runSubagentOnce } from "../node_modules/pi-schedule-prompt/dist/subagent.js";
import { configureDream } from "../configure-dream.mjs";
import { dreamRunId } from "../dream-runtime.ts";
import { CronScheduler } from "../node_modules/pi-schedule-prompt/dist/scheduler.js";
import { CronStorage } from "../node_modules/pi-schedule-prompt/dist/storage.js";
import { collectMessages } from "../session-messages.ts";
const schedulerRequire = createRequire(
  await realpath(new URL("../node_modules/pi-schedule-prompt/dist/scheduler.js", import.meta.url)),
);
const { Cron } = await import(schedulerRequire.resolve("croner"));

// The scheduler uses Croner's process-local timezone, not UTC, and queues no
// missed executions. The shared runtime identity chooses only the latest due day.
for (const [now, due, next] of [
  ["2026-10-21T06:59:59Z", "2026-10-20T07:00:00.000Z", "2026-10-21T07:00:00.000Z"],
  ["2026-10-21T07:00:00Z", "2026-10-21T07:00:00.000Z", "2026-10-22T07:00:00.000Z"],
  ["2026-11-02T20:00:00Z", "2026-11-02T08:00:00.000Z", "2026-11-03T08:00:00.000Z"],
]) {
  const cron = new Cron("0 0 3 * * *", { paused: true });
  assert.equal(cron.nextRun(new Date(now)).toISOString(), next);
  assert.equal(dreamRunId(new Date(now)), due);
  cron.stop();
}
assert.equal(CronScheduler.isLoadedFor({ id: "owned" }, "replacement-session"), true);

const [directory] = process.argv.slice(2);
const agent = join(directory, ".pi");
const data = join(directory, "memory");
process.env.BATTUTA_MEMORY_DATA_DIR = data;
await mkdir(agent, { recursive: true });
await writeFile(join(directory, "AGENTS.md"), "Offline inherited instructions marker.");
const otherExtension = join(directory, "unselected.ts");
const factoryMarker = join(directory, "factory-marker");
await writeFile(
  otherExtension,
  `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(factoryMarker)}, 'import\\n');
export default function(pi) {
  appendFileSync(${JSON.stringify(factoryMarker)}, 'factory\\n');
  pi.on('session_start', () => appendFileSync(${JSON.stringify(factoryMarker)}, 'UNSELECTED_LIFECYCLE\\n'));
  pi.registerTool({name:'telegram_message', label:'Excluded', description:'Excluded', parameters:{type:'object',properties:{}}, async execute(){ throw new Error('Excluded tool executed'); }});
}`,
);
await mkdir(join(agent, "skills", "unselected"), { recursive: true });
await writeFile(
  join(agent, "skills", "unselected", "SKILL.md"),
  "---\nname: unselected\ndescription: UNSELECTED_SKILL_MARKER\n---\nExcluded skill.\n",
);
let agentCalls = 0;
let profileCalls = 0;
let inventoryCalls = 0;
let nativeLists = 0;
const reflection = "Nothing material changed in the available memories or owner profile.";
const requests = [];
let holdRequest;
let hold = false;
let holdService = false;
let heldClosed;
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (req.url === "/mcp" || req.url === "/native") {
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
      else if (input.method === "tools/list") {
        nativeLists++;
        result = {
          tools: [
            {
              name: "escape",
              description: "Must not be exposed to dream",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      } else {
        assert.notEqual(req.url, "/native", "Native MCP tool must never execute");
        assert.equal(input.method, "tools/call");
        assert.ok(
          ["memory_inventory", "memory_consolidate_global", "memory_global_relationships"].includes(
            input.params.name,
          ),
        );
        if (holdService) {
          holdRequest?.();
          return;
        }
        if (input.params.name === "memory_inventory") inventoryCalls++;
        const args = input.params.arguments;
        const data =
          input.params.name === "memory_global_relationships"
            ? {
                status: "unavailable",
                generation_id: null,
                input_fingerprint: null,
                algorithm_fingerprint: null,
                edges: [],
                truncated: false,
              }
            : input.params.name === "memory_consolidate_global"
              ? {
                  status: "published",
                  generation_id: "a".repeat(64),
                  input_fingerprint: "b".repeat(64),
                  algorithm_fingerprint: "c".repeat(64),
                  input_count: 0,
                  cluster_count: 0,
                  edge_count: 0,
                }
              : {
                  records: [],
                  recent_refs: [],
                  inactive: [],
                  window_start: args.window_start,
                  window_end: args.window_end,
                };
        result = {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: { ok: true, data },
        };
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
      return;
    }
    assert.equal(req.headers.authorization, "Bearer offline-only-key");
    requests.push(input);
    let content;
    let tool;
    if (input.tools?.length) {
      assert.deepEqual(
        input.tools.map((t) => t.function.name),
        ["memory_dream"],
      );
      assert.ok(JSON.stringify(input.messages).includes("Offline inherited instructions marker"));
      assert.ok(!JSON.stringify(input.messages).includes("UNSELECTED_SKILL_MARKER"));
      agentCalls++;
      if (hold) {
        res.on("close", () => heldClosed?.());
        holdRequest?.();
        return;
      }
      if (agentCalls === 1)
        tool = { name: "request_tools", arguments: JSON.stringify({ tools: ["bash", "write"] }) };
      else if (agentCalls === 2)
        tool = {
          name: "bash",
          arguments: JSON.stringify({ command: `touch '${join(directory, "ESCAPED")}'` }),
        };
      else if (agentCalls === 3) tool = { name: "memory_dream", arguments: "{}" };
      else
        content =
          input.messages.findLast((message) => message.role === "tool")?.content ?? reflection;
    } else if (
      JSON.stringify(input.messages).includes("Refresh the whole high-level personal profile")
    ) {
      profileCalls++;
      content = JSON.stringify({
        sections: Object.fromEntries(
          [
            "backgroundAndRole",
            "goalsAndPriorities",
            "valuesAndDecisionMaking",
            "lifeContextAndInterests",
            "enduringPreferencesAndConstraints",
          ].map((key) => [key, []]),
        ),
      });
    } else content = reflection;
    const message = tool
      ? {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `call${agentCalls}`, type: "function", function: tool }],
        }
      : { role: "assistant", content };
    if (input.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const delta = tool
        ? { role: "assistant", tool_calls: [{ index: 0, ...message.tool_calls[0] }] }
        : { role: "assistant", content };
      for (const [d, finish] of [
        [delta, null],
        [{}, tool ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "offline", object: "chat.completion.chunk", created: 1, model: "offline-model", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    } else
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "offline",
          object: "chat.completion",
          created: 1,
          model: "offline-model",
          choices: [{ index: 0, message, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
process.env.BATTUTA_MEMORY_URL = `${baseUrl}/mcp`;
await writeFile(
  join(agent, "mcp.json"),
  JSON.stringify({
    mcpServers: {
      direct: { type: "http", url: `${baseUrl}/native`, exposure: "direct" },
      code: { type: "http", url: `${baseUrl}/native`, exposure: "codemode" },
    },
  }),
);
await writeFile(
  join(agent, "auth.json"),
  JSON.stringify({ offline: { type: "api_key", key: "offline-only-key" } }),
);
await writeFile(
  join(directory, "parent-auth.json"),
  JSON.stringify({ offline: { type: "api_key", key: "parent-runtime-only-key" } }),
);
await writeFile(
  join(agent, "models.json"),
  JSON.stringify({
    providers: {
      offline: {
        baseUrl: `${baseUrl}/v1`,
        api: "openai-completions",
        models: [
          {
            id: "offline-model",
            name: "Offline",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32768,
            maxTokens: 8192,
          },
        ],
      },
    },
  }),
);
await writeFile(
  join(agent, "settings.json"),
  JSON.stringify({
    defaultProvider: "offline",
    defaultModel: "offline-model",
    extensions: [otherExtension],
  }),
);
await configureDream(directory);
const job = JSON.parse(await readFile(join(agent, "schedule-prompts.json"), "utf8")).jobs[0];
assert.deepEqual(new CronStorage(directory).getAllJobs(), [job]);
const cronMarkers = [];
const cronPi = { sendMessage: (...args) => cronMarkers.push(args), events: { emit: () => {} } };
for (const jobs of [[job], [{ ...job, enabled: false }], []]) {
  const scheduler = new CronScheduler({ getAllJobs: () => jobs, updateJob: () => {} }, cronPi, {
    sessionManager: { getSessionId: () => "replacement-session" },
  });
  scheduler.start();
  const next = scheduler.getNextRun(job.id);
  if (jobs[0]?.enabled) {
    assert.equal(next.getHours(), 3);
    assert.ok(next > new Date());
  } else assert.equal(next, null);
  assert.deepEqual(cronMarkers, [], "Pinned scheduler start does not replay missed days");
  scheduler.stop();
}
// Scheduler 0.4.1 passes the obsolete modelRegistry SDK option. Pi 1.0.0
// ignores it and constructs a fresh runtime from agentDir's persisted config.
const runtime = await ModelRuntime.create({
  authPath: join(directory, "parent-auth.json"),
  modelsPath: join(agent, "models.json"),
  refreshOnCreate: false,
});
const registry = new ModelRegistry(runtime);
const ctx = { cwd: directory, modelRegistry: registry };
try {
  const result = await runSubagentOnce(ctx, job.prompt, job.model, undefined, {
    extensions: job.extensions,
    skills: job.skills,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(agentCalls >= 4, JSON.stringify({ result, agentCalls }));
  assert.equal(profileCalls, 1);
  assert.ok(inventoryCalls > 0, "Dream reads evidence through its MCP service");
  // The SDK loader here has no CLI built-in extension factories: native MCP
  // config is present but not connected. Tools in every provider request still
  // must be exactly memory_dream (no MCP/codemode/request_tools escape hatch).
  assert.equal(nativeLists, 0);
  const factoryCode = await readFile(factoryMarker, "utf8");
  assert.ok(factoryCode.includes("factory"), "Selector is post-factory, not a code sandbox");
  assert.ok(
    !factoryCode.includes("UNSELECTED_LIFECYCLE"),
    "Unselected lifecycle hooks are excluded",
  );
  assert.ok(requests.some((r) => JSON.stringify(r.messages).includes("not found")));
  await assert.rejects(access(join(directory, "ESCAPED")));
  const state = JSON.parse(await readFile(join(data, "dream-state.json"), "utf8"));
  assert.equal(state.completed, true);
  assert.equal(result.text, state.reflection);
  const usage = await readFile(join(data, "dream-usage.jsonl"), "utf8");
  assert.ok(!usage.includes(reflection));
  assert.equal(usage.trim().split("\n").length, 2);
  const log = await readFile(join(data, "dream.log"), "utf8");
  assert.equal(log.trim().split("\n").length, 1);
  assert.ok(log.includes(reflection));
  assert.ok(!(await readdir(data)).includes("capture-queue"));
  // Duplicate child uses the runtime checkpoint, not another synthesis/log line.
  agentCalls = 2;
  await runSubagentOnce(ctx, job.prompt, job.model, undefined, {
    extensions: job.extensions,
    skills: [],
  });
  assert.equal(profileCalls, 1);
  assert.equal(await readFile(join(data, "dream.log"), "utf8"), log);
  // Actual pinned child abort boundary (not a mocked scheduler).
  hold = true;
  const reached = new Promise((resolve) => {
    holdRequest = resolve;
  });
  const abort = new AbortController();
  const pending = runSubagentOnce(ctx, job.prompt, job.model, abort.signal, {
    extensions: job.extensions,
    skills: [],
  });
  await reached;
  abort.abort();
  await Promise.race([
    pending,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Pinned child abort timed out")), 3000),
    ),
  ]);
  // Cancellation while the tool is waiting on an unavailable memory service
  // must settle as well; no success checkpoint/log may be published.
  hold = false;
  holdService = true;
  agentCalls = 2;
  process.env.BATTUTA_MEMORY_DATA_DIR = join(directory, "cancelled-memory");
  const reachedService = new Promise((resolve) => {
    holdRequest = resolve;
  });
  const abortTool = new AbortController();
  const pendingTool = runSubagentOnce(ctx, job.prompt, job.model, abortTool.signal, {
    extensions: job.extensions,
    skills: [],
  });
  await reachedService;
  abortTool.abort();
  await Promise.race([
    pendingTool,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Pinned tool abort timed out")), 3000),
    ),
  ]);
  await assert.rejects(access(join(directory, "cancelled-memory", "dream-state.json")));
  await assert.rejects(access(join(directory, "cancelled-memory", "dream.log")));
  // Exercise the actual scheduler's stop() path with an active child, rather
  // than assuming its shutdown controller reaches the child.
  hold = true;
  holdService = false;
  const markers = [];
  const stoppedRequest = new Promise((resolve) => {
    holdRequest = resolve;
  });
  const closed = new Promise((resolve) => {
    heldClosed = resolve;
  });
  const storage = { getJob: () => job, updateJob: () => {}, getAllJobs: () => [job] };
  const pi = {
    sendMessage: (message, options) => markers.push({ message, options }),
    events: { emit: () => {} },
  };
  const scheduler = new CronScheduler(storage, pi, {
    ...ctx,
    sessionManager: { getSessionId: () => "main" },
  });
  scheduler.addJob({ ...job, type: "once", schedule: new Date(Date.now() + 20).toISOString() });
  await stoppedRequest;
  scheduler.stop();
  await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Scheduler stop did not abort child")), 3000),
    ),
  ]);
  assert.equal(markers.length, 1, "Stopped scheduler posts no result marker");
  assert.deepEqual(
    collectMessages(
      markers.map(({ message }, i) => ({ ...message, id: `marker${i}`, type: "custom_message" })),
    ),
    [],
  );
  console.log("Pinned scheduler dream isolation passed");
} finally {
  server.closeAllConnections();
  server.close();
}
