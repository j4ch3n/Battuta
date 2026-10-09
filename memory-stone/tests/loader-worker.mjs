import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, realpath, writeFile } from "node:fs/promises";

const [database, agentDirectory, hostPiEntry] = process.argv.slice(2);
const piModule = hostPiEntry
  ? pathToFileURL(await realpath(hostPiEntry)).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const { discoverAndLoadExtensions } = await import(piModule);
const { normalizeBuildSystemPromptOptions, buildSystemPromptState } = await import(
  new URL("./core/system-prompt.js", piModule)
);
const { getCurrentSystemMessage } = await import(new URL("../../pi-ai/dist/index.js", piModule));
process.env.PI_MEMORY_STONE_DB_PATH = database;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
const entry = new URL("../index.ts", import.meta.url).pathname;
await writeFile(
  `${agentDirectory}/settings.json`,
  JSON.stringify({ battutaMemory: { ownerProfile: true } }),
);
const loaded = await discoverAndLoadExtensions([entry], agentDirectory, agentDirectory);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
const context = {
  sessionManager: { getSessionId: () => "loader-smoke", getBranch: () => [] },
  hasUI: false,
  ui: { notify: () => {}, setStatus: () => {} },
  model: { id: "loader-model" },
  modelRegistry: {
    complete: async (_model, input) => {
      const evidence = JSON.parse(input.messages[0].content);
      assert.match(evidence.existingDocument, /# About Human Product Owner/);
      assert.equal(evidence.ownerMessage, "Remember that I prefer concise summaries.");
      return {
        content: [
          {
            type: "text",
            text: "# About Human Product Owner\n\n## Preferences\nPrefers concise summaries.\n",
          },
        ],
        stopReason: "stop",
        usage: { input: 10, output: 12, totalTokens: 22 },
      };
    },
  },
};
try {
  const remember = extension.tools.get("memory_remember").definition;
  const saved = await remember.execute(
    "save",
    {
      kind: "preference",
      text: "Prefer concise summaries",
      scope: "global",
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
  const update = extension.tools.get("profile_update").definition;
  const savedProfile = await update.execute(
    "profile",
    {
      message: "Remember that I prefer concise summaries.",
      interpretation: "Confirmed overall preference.",
      operation: "remember",
      expectedRevision: "missing",
    },
    undefined,
    undefined,
    context,
  );
  assert.notEqual(savedProfile.details.error, true, JSON.stringify(savedProfile));
  assert.equal(savedProfile.details.usage.totalTokens, 22);
  const document = await readFile(`${agentDirectory}/ME.md`, "utf8");
  const options = normalizeBuildSystemPromptOptions({
    cwd: agentDirectory,
    sections: { other_extension: "Keep me" },
  });
  for (const handler of extension.handlers.get("before_agent_start") ?? [])
    await handler({ prompt: "summaries", systemPromptOptions: options }, context);
  const initial = { role: "system", ...buildSystemPromptState(options), timestamp: Date.now() };
  assert.equal(
    initial.sections.battuta_owner_profile,
    `<battuta_owner_profile>\n${document}\n</battuta_owner_profile>`,
  );
  assert.match(initial.sections.battuta_memory, /concise summaries/);
  const deleted = await extension.tools
    .get("memory_forget")
    .definition.execute("delete", { ref: saved.details.ref }, undefined, undefined, context);
  assert.equal(deleted.details.deleted, true, JSON.stringify(deleted));
  let messages = [initial];
  for (const handler of extension.handlers.get("context_with_system") ?? []) {
    const patch = await handler({ messages }, context);
    if (patch) messages = patch.messages;
  }
  const current = getCurrentSystemMessage(messages);
  assert.equal(current.sections.battuta_memory, undefined);
  assert.equal(current.sections.battuta_owner_profile, initial.sections.battuta_owner_profile);
  assert.equal(current.sections.other_extension, initial.sections.other_extension);
  context.modelRegistry.complete = async () => {
    throw new Error("Provider unavailable");
  };
  const failed = await update.execute(
    "failure",
    {
      message: "Correct my preference",
      interpretation: "",
      operation: "correct",
      expectedRevision: savedProfile.details.revision,
    },
    undefined,
    undefined,
    context,
  );
  assert.equal(failed.details.error, true);
  assert.equal(await readFile(`${agentDirectory}/ME.md`, "utf8"), document);
  console.log("Pi loader smoke passed: bridge-only registration and global recall");
} finally {
  for (const shutdown of extension.handlers.get("session_shutdown") ?? [])
    await shutdown({}, context);
}
