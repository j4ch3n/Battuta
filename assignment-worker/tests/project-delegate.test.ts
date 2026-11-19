import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerProjectDelegate } from "../project-delegate.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

// A package-local stand-in for pi-harness-delegate's entry point: it registers the tools the real one does
// and reports the cwd and parameters each run tool receives.
const FAKE_PACKAGE = `
export default function (pi) {
  for (const name of ["delegate", "claude_delegate", "delegate_modes"])
    pi.registerTool({
      name,
      label: name,
      description: name + " tool.",
      parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
      execute: async (_id, params, _signal, _update, ctx) => ({
        content: [{ type: "text", text: "ok" }],
        details: { cwd: ctx.cwd, params, hasUI: ctx.hasUI },
      }),
    });
  pi.registerCommand("delegate", { description: "status", handler: async () => {} });
}
`;

let fixture: ProjectsFixture;
let agentDir: string;
beforeEach(async () => {
  fixture = await createProjectsFixture();
  agentDir = join(fixture.home, "agent");
  const dir = join(agentDir, "npm/node_modules/pi-harness-delegate/extensions");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "index.ts"), FAKE_PACKAGE);
});
afterEach(() => fixture.dispose());

type Registered = {
  description: string;
  parameters: { properties: Record<string, unknown>; required: string[] };
  execute: (
    ...args: unknown[]
  ) => Promise<{ details: { cwd: string; params: object; hasUI: boolean } }>;
};

async function install() {
  const tools = new Map<string, Registered>();
  const commands: string[] = [];
  const pi = {
    registerTool: (tool: { name: string } & Registered) => tools.set(tool.name, tool),
    registerCommand: (name: string) => commands.push(name),
  } as unknown as ExtensionAPI;
  await registerProjectDelegate(pi, { agentDir, projectsRoot: fixture.projectsRoot });
  return { tools, commands };
}

function session(project?: string) {
  return {
    cwd: "/worker/bot",
    hasUI: false,
    sessionManager: {
      getSessionFile: () => "/sessions/one.jsonl",
      getEntries: () =>
        project
          ? [
              {
                type: "custom",
                customType: "assignment-binding",
                data: { project, assignment_id: "0123abcd", claimed_at: "2026-11-19T10:00:00Z" },
              },
            ]
          : [],
    },
  } as unknown as ExtensionContext;
}

const run = (tool: Registered | undefined, params: object, ctx: ExtensionContext) =>
  tool!.execute("id", params, undefined, vi.fn(), ctx);

test.each(["delegate", "claude_delegate"])(
  "%s runs in the bound project's code folder, not the worker's cwd",
  async (name) => {
    const { tools } = await install();
    const { details } = await run(tools.get(name), { task: "x" }, session("atlas"));
    expect(details.cwd).toBe(join(fixture.projectsRoot, "atlas", "code"));
    expect(details.params).toEqual({ task: "x" });
  },
);

test("a worktree from the brief replaces the code folder and is not passed on to the package", async () => {
  const { tools } = await install();
  const { details } = await run(
    tools.get("delegate"),
    { task: "x", worktree: fixture.atlasWorktree },
    session("atlas"),
  );
  expect(details.cwd).toBe(fixture.atlasWorktree);
  expect(details.params).toEqual({ task: "x" });
});

test("a worktree of another project is refused and the package is never run", async () => {
  const { tools } = await install();
  await expect(
    run(tools.get("delegate"), { task: "x", worktree: fixture.bravoWorktree }, session("atlas")),
  ).rejects.toThrow("is not a git worktree of project");
});

test("a session that is not bound to an assignment cannot delegate", async () => {
  const { tools } = await install();
  await expect(run(tools.get("delegate"), { task: "x" }, session())).rejects.toThrow(
    "not bound to an assignment",
  );
});

test("an unregistered project cannot delegate", async () => {
  const { tools } = await install();
  await expect(run(tools.get("delegate"), { task: "x" }, session("nosuch"))).rejects.toThrow(
    'project "nosuch" has no registered folder',
  );
});

test("the run tool schema gains an optional worktree and keeps the package's own parameters", async () => {
  const { tools } = await install();
  const { parameters, description } = tools.get("delegate")!;
  expect(Object.keys(parameters.properties)).toEqual(["task", "worktree"]);
  expect(parameters.required).toEqual(["task"]);
  expect(description).toContain("delegate tool.");
});

test("tools that start no run and the package's commands are registered untouched", async () => {
  const { tools, commands } = await install();
  const modes = tools.get("delegate_modes")!;
  expect(Object.keys(modes.parameters.properties)).toEqual(["task"]);
  expect((await run(modes, {}, session())).details.cwd).toBe("/worker/bot");
  expect(commands).toEqual(["delegate"]);
});

test("a bot without the package registers nothing and does not fail", async () => {
  await fs.rm(join(agentDir, "npm"), { recursive: true });
  const { tools, commands } = await install();
  expect(tools.size).toBe(0);
  expect(commands).toEqual([]);
});
