import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { currentBinding } from "./contracts.ts";
import type { RunTracker } from "./types.ts";
import { preapprovedDirs, resolveDelegationCwd } from "./delegation-cwd.ts";
import {
  createDelegateRuns,
  interruptedNotice,
  sessionRecords,
  type DelegateRuns,
  type ToolResult,
} from "./delegate-runs.ts";

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

/** The package as pi installs it inside a bot profile: `<profile>/npm/node_modules/pi-harness-delegate`. */
const PACKAGE_ENTRY = join("npm", "node_modules", "pi-harness-delegate", "extensions", "index.ts");

/**
 * The packages the delegate package imports at runtime. They resolve from pi-coding-agent's own installation,
 * so the package uses the same copies pi does, wherever the bot profile is installed.
 */
function hostAliases(): Record<string, string> {
  const piUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const fromPi = createRequire(new URL("../package.json", piUrl));
  return {
    "@earendil-works/pi-coding-agent": fileURLToPath(piUrl),
    "@earendil-works/pi-tui": fromPi.resolve("@earendil-works/pi-tui"),
    typebox: fromPi.resolve("typebox"),
  };
}

async function exists(path: string): Promise<boolean> {
  return fs.stat(path).then(
    () => true,
    () => false,
  );
}

/** The tools of pi-harness-delegate that start a run; `claude_delegate` is its deprecated alias. */
const RUN_TOOLS = new Set(["delegate", "claude_delegate"]);

function boundAssignment(ctx: Pick<ExtensionContext, "sessionManager">) {
  const binding = currentBinding(ctx);
  if (!binding)
    throw new Error(
      "Delegation cannot start: this session is not bound to an assignment, so no project folder can be resolved. No default directory is used.",
    );
  return binding;
}

/** A run tool that starts in the background in the assignment's code folder, a worktree, or its work folder. */
function inProject(tool: Tool, projectsRoot: string, runs: () => DelegateRuns | undefined): Tool {
  const schema = tool.parameters as unknown as { properties: Record<string, unknown> };
  return {
    ...tool,
    description: `${tool.description} Starts in the background in the assignment project's code folder, or in \`cwd\`; questions and the result arrive as messages.`,
    parameters: {
      ...schema,
      properties: {
        ...schema.properties,
        cwd: Type.String({
          description:
            "Absolute path to run in: the commissioned worktree or this assignment's work folder. Omit for the project code folder.",
        }),
      },
    },
    async execute(id, params, _signal, _onUpdate, ctx) {
      const active = runs();
      if (!active) throw new Error("Delegation cannot start: the worker session has not started.");
      const { cwd: requested, ...rest } = params as { cwd?: string; sessionId?: string };
      const binding = boundAssignment(ctx);
      // A resumed session belongs to this assignment and continues in the folder it started in.
      const resumed =
        rest.sessionId === undefined ? undefined : sessionRecords(ctx).get(rest.sessionId);
      if (rest.sessionId !== undefined && !resumed)
        throw new Error(
          `Delegation cannot start: session ${rest.sessionId} was not started for this assignment.`,
        );
      if (resumed && resumed.assignment_id !== binding.assignment_id)
        throw new Error("Delegation cannot start: session belongs to another assignment.");
      const { cwd, codeFolder, workFolder } = await resolveDelegationCwd({
        project: binding.project,
        assignmentId: binding.assignment_id,
        cwd: requested ?? resumed?.cwd,
        projectsRoot,
      });
      if (resumed && cwd !== resumed.cwd)
        throw new Error(
          `Delegation cannot start: session ${rest.sessionId} ran in ${resumed.cwd}; a resumed run stays in its original folder.`,
        );
      const dirs = await preapprovedDirs({ codeFolder, workFolder, cwd });
      // No UI for the package: its confirmations (outside addDirs, danger) refuse at once instead of waiting.
      const projectCtx = Object.create(ctx, {
        cwd: { value: cwd },
        hasUI: { value: false },
      }) as typeof ctx;
      return active.start({
        assignmentId: binding.assignment_id,
        cwd,
        dirs,
        execute: (signal, onUpdate) =>
          tool.execute(id, rest, signal, onUpdate, projectCtx) as Promise<ToolResult>,
      }) as ReturnType<Tool["execute"]>;
    },
  };
}

const ORIGINAL_BUILD_ARGS = Symbol.for("battuta.delegate.buildArgs");
type ClaudeHarness = {
  binary: string;
  buildArgs: (opts: unknown) => string[];
  [ORIGINAL_BUILD_ARGS]?: (opts: unknown) => string[];
};

/** Makes the package start the proxy, under the worker's own Node, wherever it would start `claude`. */
function routeThroughProxy(claude: ClaudeHarness, proxyPath: string) {
  const original = (claude[ORIGINAL_BUILD_ARGS] ??= claude.buildArgs);
  claude.binary = process.execPath;
  claude.buildArgs = (opts) => [proxyPath, ...original.call(claude, opts)];
}

/** The compiled proxy next to the bundled extension in a release, or its source beside this file. */
async function defaultProxyPath(): Promise<string> {
  const compiled = fileURLToPath(new URL("./claude-proxy.js", import.meta.url));
  return (await exists(compiled))
    ? compiled
    : fileURLToPath(new URL("./claude-proxy.ts", import.meta.url));
}

const RunControlParameters = {
  reply: Type.Object({
    text: Type.String({
      description:
        "The answer, or guidance for the running Claude session when no requestId is given.",
    }),
    requestId: Type.Optional(
      Type.String({ description: "The id of the question or permission request being answered." }),
    ),
    allow: Type.Optional(
      Type.Boolean({ description: "For a permission request: false denies it. Defaults to true." }),
    ),
  }),
  none: Type.Object({}),
};

function controlTools(runs: () => DelegateRuns | undefined): Tool[] {
  const required = () => {
    const active = runs();
    if (!active)
      throw new Error("Delegation is not available: the worker session has not started.");
    return active;
  };
  const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
  return [
    {
      name: "delegate_reply",
      label: "Reply to Claude",
      description:
        "Answer the running Claude session's question or permission request (requestId), or send it guidance (no requestId).",
      parameters: RunControlParameters.reply,
      execute: (_id, params) =>
        Promise.resolve().then(() =>
          result(required().reply(params as { text: string; requestId?: string; allow?: boolean })),
        ),
    },
    {
      name: "delegate_status",
      label: "Claude run status",
      description: "Show the running Claude session's progress, pending requests and session id.",
      parameters: RunControlParameters.none,
      execute: () => Promise.resolve().then(() => result(required().status())),
    },
    {
      name: "delegate_stop",
      label: "Stop Claude run",
      description: "Stop the running Claude session.",
      parameters: RunControlParameters.none,
      execute: async () => result(await required().stop()),
    },
  ] as Tool[];
}

/**
 * Registers pi-harness-delegate's tools with the run tools executing in the assignment project instead of
 * the worker's own cwd. The package is installed without loading its own extension (see the manifest's
 * `pi_library`), so this is the only `delegate`. A bot without the package gets no delegation.
 */
export async function registerProjectDelegate(
  pi: ExtensionAPI,
  {
    profileDir,
    projectsRoot,
    log = console.error,
    proxyPath,
  }: {
    profileDir: string;
    projectsRoot: string;
    log?: (message: string) => void;
    /** The proxy script; defaults to the one shipped beside this extension. */
    proxyPath?: string;
  },
): Promise<RunTracker | undefined> {
  const entry = join(profileDir, PACKAGE_ENTRY);
  if (!(await exists(entry))) {
    // Error level, and the worker keeps running without delegation: a missing package must never pass silently.
    log(
      `pi-harness-delegate is not installed at ${entry}: delegate and delegate_modes are NOT registered, so no delegated run can start.`,
    );
    return;
  }
  // Node cannot import a .ts file under node_modules natively, so load it with jiti as pi loads extensions.
  // jiti is imported here, not at module top, so a missing or broken copy disables delegation only: the rest of
  // the worker extension (report_execution_result, the coordinator) still loads. fsCache is off so that nothing
  // is written into the installed profile.
  let install: (pi: ExtensionAPI) => void | Promise<void>;
  let claude: ClaudeHarness | undefined;
  try {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { alias: hostAliases(), fsCache: false });
    install = await jiti.import<(pi: ExtensionAPI) => void | Promise<void>>(entry, {
      default: true,
    });
    // The same jiti instance, so this is the registry module the package's engine reads.
    const registry = await jiti.import<{ HARNESSES?: Record<string, ClaudeHarness> }>(
      join(dirname(entry), "harnesses", "registry.ts"),
    );
    claude = registry.HARNESSES?.claude;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(
      `pi-harness-delegate could not be loaded from ${entry} (${reason}): delegate and delegate_modes are NOT registered, so no delegated run can start.`,
    );
    return;
  }
  if (typeof claude?.buildArgs !== "function") {
    log(
      `pi-harness-delegate at ${entry} has no claude harness to supervise: delegate and delegate_modes are NOT registered, so no delegated run can start.`,
    );
    return;
  }
  routeThroughProxy(claude, proxyPath ?? (await defaultProxyPath()));
  // Runs and their socket belong to one Pi session: Pi reloads extensions when it replaces the session.
  let runs: DelegateRuns | undefined;
  pi.on("session_start", async (_event, ctx) => {
    runs ??= await createDelegateRuns(pi);
    const notice = interruptedNotice(ctx);
    if (notice)
      pi.sendMessage(
        { customType: "delegate-run", content: notice, display: true },
        { triggerTurn: false },
      );
  });
  pi.on("session_shutdown", async () => {
    await runs?.close();
    runs = undefined;
  });
  await install(
    new Proxy(pi, {
      get(target, property) {
        if (property === "registerTool")
          return (tool: Tool) =>
            target.registerTool(
              RUN_TOOLS.has(tool.name) ? inProject(tool, projectsRoot, () => runs) : tool,
            );
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    }),
  );
  for (const tool of controlTools(() => runs)) pi.registerTool(tool);
  return {
    isRunActive: () => runs?.active ?? false,
    stop: () => runs?.stop() ?? Promise.resolve(),
  };
}
