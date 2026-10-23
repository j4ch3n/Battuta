// Private, one-request adapter. No parent model turn or detached upstream runner.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import upstream from "pi-subagents";
import {
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
  type SubagentDelegationResponse,
} from "pi-subagents/delegation";
import type { Task } from "./runtime.ts";

process.on("disconnect", () => process.exit(1));

interface Request {
  id: string;
  task: Task;
  config: {
    inputs: string[];
    writable: string[];
    model: string;
    baseUrl: string;
    timeoutMs: number;
  };
}
async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 131072) throw new Error("Request too large");
  }
  const { id, task, config } = JSON.parse(input) as Request;
  const agentDir = process.env.PI_CODING_AGENT_DIR!;
  const cwd = process.cwd();
  const write = (path: string, value: unknown) =>
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  write(join(agentDir, "grant.json"), {
    profile: task.profile,
    inputs: config.inputs,
    writable: config.writable,
  });
  write(join(agentDir, "models.json"), {
    providers: {
      "battuta-child": {
        baseUrl: config.baseUrl,
        api: "openai-completions",
        apiKey: "$BATTUTA_CHILD_API_KEY",
        models: [
          {
            id: config.model,
            name: config.model,
            reasoning: false,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  });
  write(join(agentDir, "settings.json"), {
    retry: { enabled: false },
    subagent: { maxConcurrency: 1, maxSubagentDepth: 0 },
  });
  mkdirSync(join(agentDir, "agents"), { mode: 0o700 });
  const tools = [
    "bounded_read",
    "bounded_files",
    ...(task.profile === "worker" ? ["bounded_write"] : []),
  ];
  const header = {
    name: task.profile,
    description: `Bounded ${task.profile}`,
    tools,
    extensions: [fileURLToPath(new URL("./child-tools.ts", import.meta.url))],
    inheritProjectContext: false,
    inheritGlobalContext: false,
    inheritSkills: false,
    allowNestedSubagents: false,
    allowedAgents: [],
    maxSubagentDepth: 0,
    defaultContext: "fresh",
    model: `battuta-child/${config.model}`,
  };
  const yaml = Object.entries(header)
    .map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : JSON.stringify(value)}`,
    )
    .join("\n");
  writeFileSync(
    join(agentDir, "agents", `${task.profile}.md`),
    `---\n${yaml}\n---\nYou are a focused ${task.profile}. Use only the supplied snapshot. Return attributable findings, changed paths, evidence and limitations. Never claim acceptance or verification not performed.\n`,
    { mode: 0o600 },
  );
  let api!: ExtensionAPI;
  let sessionId = "";
  let finish!: (value: SubagentDelegationResponse) => void;
  const result = new Promise<SubagentDelegationResponse>((resolve) => {
    finish = resolve;
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      { name: "bounded-upstream", factory: upstream },
      {
        name: "bounded-host",
        factory(pi) {
          api = pi;
          pi.on("session_start", (_event, ctx) => {
            sessionId = ctx.sessionManager.getSessionId();
          });
          pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (value) => {
            const response = value as SubagentDelegationResponse;
            if (response.requestId === id) finish(response);
          });
        },
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.create(cwd, agentDir),
    tools: [],
  });
  try {
    await session.bindExtensions({
      mode: "print",
      onError(error) {
        throw new Error(`${error.extensionPath}: ${error.error}`);
      },
    });
    api.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, {
      requestId: id,
      ownerRunId: sessionId,
      nodeId: id,
      agent: task.profile,
      context: "fresh",
      cwd,
      model: `battuta-child/${config.model}`,
      timeoutMs: config.timeoutMs,
      skill: false,
      artifacts: false,
      result: { kind: "text" },
      task: `Objective: ${task.objective}\nInputs: ${task.inputs.join(", ")}\nScope: ${task.scope}\nExpected evidence: ${task.evidence}`,
    });
    const terminal = await result;
    await new Promise<void>((resolve, reject) =>
      process.send!(terminal, (error) => (error ? reject(error) : resolve())),
    );
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
}
main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.send?.({
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 2000) : "Child startup failed",
    });
    process.exit(1);
  },
);
