import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { currentBinding } from "./contracts.ts";
import { resolveDelegationCwd } from "./delegation-cwd.ts";

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

const PACKAGE_ENTRY = "npm/node_modules/pi-harness-delegate/extensions/index.ts";

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
  { agentDir, projectsRoot }: { agentDir: string; projectsRoot: string },
): Promise<void> {
  const entry = join(agentDir, PACKAGE_ENTRY);
  if (
    !(await fs.stat(entry).then(
      () => true,
      () => false,
    ))
  )
    return;
  const { default: install } = (await import(entry)) as {
    default: (pi: ExtensionAPI) => void | Promise<void>;
  };
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
