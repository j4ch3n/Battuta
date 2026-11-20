import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerProjectDelegate } from "../project-delegate.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

// A package-local stand-in for pi-harness-delegate's entry point: it is TypeScript with a runtime import of a
// pi peer (as the real package has), registers the tools the real one does, and reports the cwd and parameters
// each run tool receives.
const FAKE_PACKAGE = `
import { visibleWidth } from "@earendil-works/pi-tui";
export default function (pi: any) {
  for (const name of ["delegate", "claude_delegate", "delegate_modes"])
    pi.registerTool({
      name,
      label: name,
      description: name + " tool.",
      parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
      execute: async (_id: string, params: object, _signal: unknown, _update: unknown, ctx: any) => ({
        content: [{ type: "text", text: "ok" }],
        details: { cwd: ctx.cwd, params, hasUI: ctx.hasUI, peerWidth: visibleWidth("abc") },
      }),
    });
  pi.registerCommand("delegate", { description: "status", handler: async () => {} });
}
`;

let fixture: ProjectsFixture;
let profileDir: string;
beforeEach(async () => {
  fixture = await createProjectsFixture();
  profileDir = join(fixture.home, "profile");
  const dir = join(profileDir, "npm/node_modules/pi-harness-delegate/extensions");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "index.ts"), FAKE_PACKAGE);
});
afterEach(() => fixture.dispose());

type Registered = {
  description: string;
  parameters: { properties: Record<string, unknown>; required: string[] };
  execute: (
    ...args: unknown[]
  ) => Promise<{ details: { cwd: string; params: object; hasUI: boolean; peerWidth?: number } }>;
};

async function install(log = vi.fn()) {
  const tools = new Map<string, Registered>();
  const commands: string[] = [];
  const pi = {
    registerTool: (tool: { name: string } & Registered) => tools.set(tool.name, tool),
    registerCommand: (name: string) => commands.push(name),
  } as unknown as ExtensionAPI;
  await registerProjectDelegate(pi, { profileDir, projectsRoot: fixture.projectsRoot, log });
  return { tools, commands, log };
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
  ).rejects.toThrow("is not the code folder, a worktree, or the assignment work folder of project");
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

test("the package's runtime peer imports resolve to pi's own copies, so its tools run", async () => {
  const { tools } = await install();
  const { details } = await run(tools.get("delegate"), { task: "x" }, session("atlas"));
  expect(details.peerWidth).toBe(3);
});

test("a missing package logs at error level, names the path and registers nothing", async () => {
  await fs.rm(join(profileDir, "npm"), { recursive: true });
  const log = vi.fn();
  const { tools, commands } = await install(log);
  expect(tools.size).toBe(0);
  expect(commands).toEqual([]);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][0]).toContain(
    join(profileDir, "npm/node_modules/pi-harness-delegate/extensions/index.ts"),
  );
  expect(log.mock.calls[0][0]).toContain("NOT registered");
});

test("a present package logs nothing", async () => {
  const { log } = await install();
  expect(log).not.toHaveBeenCalled();
});

test("a missing jiti logs at error level and registers nothing, so the rest of the extension still loads", async () => {
  vi.resetModules();
  // jiti is unavailable: loading it fails before any package file is read.
  vi.doMock("jiti", () => ({
    createJiti: () => {
      throw new Error("jiti is unavailable");
    },
  }));
  try {
    const { registerProjectDelegate: loadDelegate } = await import("../project-delegate.ts");
    const tools = new Map<string, unknown>();
    const commands: string[] = [];
    const log = vi.fn();
    const pi = {
      registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
      registerCommand: (name: string) => commands.push(name),
    } as unknown as ExtensionAPI;
    await expect(
      loadDelegate(pi, { profileDir, projectsRoot: fixture.projectsRoot, log }),
    ).resolves.toBeUndefined();
    expect(tools.size).toBe(0);
    expect(commands).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("jiti is unavailable");
    expect(log.mock.calls[0][0]).toContain("NOT registered");
  } finally {
    vi.doUnmock("jiti");
    vi.resetModules();
  }
});
