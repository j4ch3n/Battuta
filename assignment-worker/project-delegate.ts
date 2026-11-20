import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { currentBinding } from "./contracts.ts";
import { resolveDelegationCwd } from "./delegation-cwd.ts";

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

function boundProject(ctx: Pick<ExtensionContext, "sessionManager">): string {
  const binding = currentBinding(ctx);
  if (!binding)
    throw new Error(
      "Delegation cannot start: this session is not bound to an assignment, so no project folder can be resolved. No default directory is used.",
    );
  return binding.project;
}

/** A run tool that executes with the assignment's project folder (or `worktree`) as the extension's cwd. */
function inProject(tool: Tool, projectsRoot: string): Tool {
  const schema = tool.parameters as unknown as { properties: Record<string, unknown> };
  return {
    ...tool,
    description: `${tool.description} Runs in the assignment project's code folder, or in \`worktree\` when the assignment brief supplies one.`,
    parameters: {
      ...schema,
      properties: {
        ...schema.properties,
        worktree: Type.String({
          description:
            "Absolute path of a git worktree of this project's repository. Pass only when the assignment brief supplies one; omit to run in the project code folder.",
        }),
      },
    },
    async execute(id, params, signal, onUpdate, ctx) {
      const { worktree, ...rest } = params as { worktree?: string };
      const cwd = await resolveDelegationCwd({
        project: boundProject(ctx),
        worktree,
        projectsRoot,
      });
      const projectCtx = Object.create(ctx, { cwd: { value: cwd } }) as typeof ctx;
      return tool.execute(id, rest, signal, onUpdate, projectCtx);
    },
  };
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
  }: { profileDir: string; projectsRoot: string; log?: (message: string) => void },
): Promise<void> {
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
  try {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { alias: hostAliases(), fsCache: false });
    install = await jiti.import<(pi: ExtensionAPI) => void | Promise<void>>(entry, {
      default: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(
      `pi-harness-delegate could not be loaded from ${entry} (${reason}): delegate and delegate_modes are NOT registered, so no delegated run can start.`,
    );
    return;
  }
  await install(
    new Proxy(pi, {
      get(target, property) {
        if (property === "registerTool")
          return (tool: Tool) =>
            target.registerTool(RUN_TOOLS.has(tool.name) ? inProject(tool, projectsRoot) : tool);
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    }),
  );
}
