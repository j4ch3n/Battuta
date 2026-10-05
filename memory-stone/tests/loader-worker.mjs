import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [database, agentDirectory, hostPiEntry] = process.argv.slice(2);
const piModule = hostPiEntry
  ? pathToFileURL(hostPiEntry).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const { discoverAndLoadExtensions } = await import(piModule);
process.env.PI_MEMORY_STONE_DB_PATH = database;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
const entry = new URL("../index.ts", import.meta.url).pathname;
const loaded = await discoverAndLoadExtensions([entry], agentDirectory, agentDirectory);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
const context = { sessionManager: { getSessionId: () => "loader-smoke" } };
try {
  const remember = extension.tools.get("memory_remember").definition;
  const saved = await remember.execute(
    "save",
    {
      kind: "preference",
      text: "Prefer concise summaries",
      scope: "global",
      userRequested: true,
      globalRequested: true,
    },
    undefined,
    undefined,
    context,
  );
  assert.equal(saved.details.scope, "global");
  const recall = await extension.tools
    .get("memory_search")
    .definition.execute(
      "recall",
      { query: "summaries", scope: "global" },
      undefined,
      undefined,
      context,
    );
  assert.equal(recall.details.results.length, 1);
  console.log("Pi loader smoke passed: bridge-only registration and global recall");
} finally {
  for (const shutdown of extension.handlers.get("session_shutdown") ?? [])
    await shutdown({}, context);
}
