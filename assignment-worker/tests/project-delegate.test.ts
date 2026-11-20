import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connectChannel, type WorkerMessage } from "../delegate-channel.ts";
import { registerProjectDelegate } from "../project-delegate.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

// A package-local stand-in for pi-harness-delegate's entry point: it is TypeScript with a runtime import of a
// pi peer (as the real package has), registers the tools the real one does, and reports what each run tool
// receives: its cwd and parameters, the claude harness command it would start, and the delegate environment.
// A run settles at once unless a test holds it through \`globalThis.fakeDelegate\`.
const FAKE_REGISTRY = `
export const HARNESSES = {
  claude: { binary: "claude", buildArgs: (o: { prompt: string }) => ["-p", o.prompt] },
};
export const getHarness = (name: string) => (HARNESSES as Record<string, unknown>)[name];
`;
const FAKE_PACKAGE = `
import { visibleWidth } from "@earendil-works/pi-tui";
import { getHarness } from "./harnesses/registry.ts";
export default function (pi: any) {
  for (const name of ["delegate", "claude_delegate", "delegate_modes"])
    pi.registerTool({
      name,
      label: name,
      description: name + " tool.",
      parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
      execute: (_id: string, params: object, signal: AbortSignal, onUpdate: any, ctx: any) => {
        const claude = getHarness("claude") as any;
        const env = Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.startsWith("BATTUTA_DELEGATE_")),
        );
        const details = {
          cwd: ctx.cwd,
          params,
          hasUI: ctx.hasUI,
          peerWidth: visibleWidth("abc"),
          command: [claude.binary, ...claude.buildArgs({ prompt: "p" })],
          env,
        };
        const result = { content: [{ type: "text", text: "package report" }], details };
        const control = (globalThis as any).fakeDelegate;
        if (!control?.hold || name === "delegate_modes") return Promise.resolve(result);
        return new Promise((resolve, reject) => {
          control.runs.push({ resolve: () => resolve(result), reject, signal, onUpdate, details });
          signal?.addEventListener("abort", () => reject(new Error("cancelled")));
        });
      },
    });
  pi.registerCommand("delegate", { description: "status", handler: async () => {} });
}
`;

type HeldRun = {
  resolve(): void;
  reject(error: Error): void;
  signal: AbortSignal;
  onUpdate?: (partial: unknown) => void;
  details: { env: Record<string, string> };
};
const held = () =>
  (globalThis as unknown as { fakeDelegate: { runs: HeldRun[] } }).fakeDelegate.runs;
function hold() {
  (globalThis as unknown as { fakeDelegate: unknown }).fakeDelegate = { hold: true, runs: [] };
}

let fixture: ProjectsFixture;
let profileDir: string;
const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(async () => {
  fixture = await createProjectsFixture();
  profileDir = join(fixture.home, "profile");
  const dir = join(profileDir, "npm/node_modules/pi-harness-delegate/extensions");
  await fs.mkdir(join(dir, "harnesses"), { recursive: true });
  await fs.writeFile(join(dir, "index.ts"), FAKE_PACKAGE);
  await fs.writeFile(join(dir, "harnesses", "registry.ts"), FAKE_REGISTRY);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  delete (globalThis as unknown as { fakeDelegate?: unknown }).fakeDelegate;
  vi.useRealTimers();
  await fixture.dispose();
});

type Registered = {
  description: string;
  parameters: { properties: Record<string, unknown>; required: string[] };
  execute: (...args: unknown[]) => Promise<{
    content: { type: string; text: string }[];
    details: {
      cwd: string;
      params: object;
      hasUI: boolean;
      peerWidth?: number;
      command: string[];
      env: Record<string, string>;
    };
  }>;
};

async function install(log = vi.fn(), proxyPath?: string) {
  const tools = new Map<string, Registered>();
  const commands: string[] = [];
  const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
  const sendMessage = vi.fn();
  const appendEntry = vi.fn();
  const pi = {
    registerTool: (tool: { name: string } & Registered) => tools.set(tool.name, tool),
    registerCommand: (name: string) => commands.push(name),
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) =>
      handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendMessage,
    appendEntry,
  } as unknown as ExtensionAPI;
  const handle = await registerProjectDelegate(pi, {
    profileDir,
    projectsRoot: fixture.projectsRoot,
    log,
    ...(proxyPath ? { proxyPath } : {}),
  });
  const emit = async (event: string, ctx: unknown = session("atlas"), data: object = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...data }, ctx);
  };
  await emit("session_start", session("atlas"), { reason: "startup" });
  cleanups.push(() => emit("session_shutdown"));
  return { tools, commands, log, sendMessage, appendEntry, handle, emit };
}

function session(project?: string, entries: object[] = []) {
  return {
    cwd: "/worker/bot",
    hasUI: true,
    sessionManager: {
      getSessionFile: () => "/sessions/one.jsonl",
      getEntries: () => [
        ...(project
          ? [
              {
                type: "custom",
                customType: "assignment-binding",
                data: { project, assignment_id: "0123abcd", claimed_at: "2026-11-19T10:00:00Z" },
              },
            ]
          : []),
        ...entries,
      ],
    },
  } as unknown as ExtensionContext;
}

const run = (tool: Registered | undefined, params: object, ctx: ExtensionContext) =>
  tool!.execute("id", params, undefined, vi.fn(), ctx);

/** Plays the proxy of the held run: connects with the run's token and announces the session. */
async function proxyFor(run: HeldRun, sessionId = "s-1") {
  const client = await connectChannel(
    run.details.env.BATTUTA_DELEGATE_SOCKET,
    run.details.env.BATTUTA_DELEGATE_TOKEN,
  );
  const received: WorkerMessage[] = [];
  client.onMessage((message) => received.push(message));
  client.send({ type: "started", sessionId });
  cleanups.push(() => client.close());
  return { client, received };
}

/** Starts a held delegate run and plays its proxy until the tool call returns. */
async function startHeld(tools: Map<string, Registered>, params: object = { task: "x" }) {
  hold();
  const call = run(tools.get("delegate"), params, session("atlas"));
  await vi.waitFor(() => expect(held()).toHaveLength(1));
  const proxy = await proxyFor(held()[0]);
  return { result: await call, heldRun: held()[0], ...proxy };
}

test.each(["delegate", "claude_delegate"])(
  "%s runs in the bound project's code folder, not the worker's cwd",
  async (name) => {
    const { tools } = await install();
    const { details } = await run(tools.get(name), { task: "x" }, session("atlas"));
    expect(details.cwd).toBe(join(fixture.projectsRoot, "atlas", "code"));
    expect(details.params).toEqual({ task: "x" });
  },
);

test("a cwd from the brief replaces the code folder and is not passed on to the package", async () => {
  const { tools } = await install();
  const { details } = await run(
    tools.get("delegate"),
    { task: "x", cwd: fixture.atlasWorktree },
    session("atlas"),
  );
  expect(details.cwd).toBe(fixture.atlasWorktree);
  expect(details.params).toEqual({ task: "x" });
});

test("a worktree of another project is refused and the package is never run", async () => {
  const { tools } = await install();
  await expect(
    run(tools.get("delegate"), { task: "x", cwd: fixture.bravoWorktree }, session("atlas")),
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

test("the run tool schema gains an optional cwd and keeps the package's own parameters", async () => {
  const { tools } = await install();
  const { parameters, description } = tools.get("delegate")!;
  expect(Object.keys(parameters.properties)).toEqual(["task", "cwd"]);
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

test("delegate returns once the run has started, before it finishes", async () => {
  const { tools, sendMessage } = await install();
  const { result, heldRun } = await startHeld(tools);
  expect(result.content[0].text).toContain("session s-1");
  expect(sendMessage).not.toHaveBeenCalled();
  heldRun.resolve();
});

test("a run that settles before it starts returns the package's result directly", async () => {
  const { tools, sendMessage } = await install();
  const { content } = await run(tools.get("delegate"), { task: "x" }, session("atlas"));
  expect(content[0].text).toBe("package report");
  expect(sendMessage).not.toHaveBeenCalled();
});

test("a second delegate while a run is active fails with the fixed text", async () => {
  const { tools } = await install();
  const { heldRun } = await startHeld(tools);
  await expect(run(tools.get("delegate"), { task: "y" }, session("atlas"))).rejects.toThrow(
    "a run is active; use delegate_status, delegate_reply or delegate_stop",
  );
  heldRun.resolve();
});

test("completion is sent as a turn-starting delegate-run message with the package's text", async () => {
  const { tools, sendMessage, handle } = await install();
  const { heldRun } = await startHeld(tools);
  expect(handle?.isRunActive()).toBe(true);
  heldRun.resolve();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      customType: "delegate-run",
      content: expect.stringContaining("package report") as string,
    }),
    { triggerTurn: true },
  );
  expect(handle?.isRunActive()).toBe(false);
});

test("a failed run is sent as a turn-starting message with the error", async () => {
  const { tools, sendMessage } = await install();
  const { heldRun } = await startHeld(tools);
  heldRun.reject(new Error("claude exited with code 1"));
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining("claude exited with code 1") as string,
    }),
    { triggerTurn: true },
  );
});

test("the claude harness runs process.execPath with the proxy script first, once per install", async () => {
  await install(vi.fn(), "/opt/proxy.js");
  const { tools } = await install(vi.fn(), "/opt/proxy.js");
  const { details } = await run(tools.get("delegate"), { task: "x" }, session("atlas"));
  expect(details.command).toEqual([process.execPath, "/opt/proxy.js", "-p", "p"]);
});

test("the run context has hasUI false", async () => {
  const { tools } = await install();
  const { details } = await run(tools.get("delegate"), { task: "x" }, session("atlas"));
  expect(details.hasUI).toBe(false);
});

test("the socket, token and pre-approved directories are set for the run and cleared after it", async () => {
  const { tools } = await install();
  const { heldRun } = await startHeld(tools);
  const env = heldRun.details.env;
  expect(env.BATTUTA_DELEGATE_SOCKET).toMatch(/battuta-delegate-\d+-[0-9a-f]{12}\.sock$/);
  expect(env.BATTUTA_DELEGATE_TOKEN).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.parse(env.BATTUTA_DELEGATE_DIRS)).toEqual(
    expect.arrayContaining([fixture.atlasWork]),
  );
  heldRun.resolve();
  await vi.waitFor(() => expect(process.env.BATTUTA_DELEGATE_TOKEN).toBeUndefined());
  expect(process.env.BATTUTA_DELEGATE_SOCKET).toBeUndefined();
  expect(process.env.BATTUTA_DELEGATE_DIRS).toBeUndefined();
});

test("delegate_reply with requestId sends an answer; without it sends guidance", async () => {
  const { tools } = await install();
  const { client, received, heldRun } = await startHeld(tools);
  client.send({
    type: "request",
    id: "r-1",
    kind: "question",
    questions: [{ question: "Which?" }],
  });
  const reply = tools.get("delegate_reply")!;
  await vi.waitFor(() =>
    expect(
      reply.execute(
        "id",
        { requestId: "r-1", text: "this one" },
        undefined,
        vi.fn(),
        session("atlas"),
      ),
    ).resolves.toBeDefined(),
  );
  await reply.execute("id", { text: "also check the docs" }, undefined, vi.fn(), session("atlas"));
  await vi.waitFor(() => expect(received).toHaveLength(2));
  expect(received).toEqual([
    { type: "answer", id: "r-1", allow: true, text: "this one" },
    { type: "guide", text: "also check the docs" },
  ]);
  heldRun.resolve();
});

test("delegate_reply to an unknown request is refused", async () => {
  const { tools } = await install();
  const { heldRun } = await startHeld(tools);
  await expect(
    tools
      .get("delegate_reply")!
      .execute("id", { requestId: "nope", text: "x" }, undefined, vi.fn(), session("atlas")),
  ).rejects.toThrow("no pending request nope");
  heldRun.resolve();
});

test("delegate_reply after the input closed returns the run-finished text", async () => {
  const { tools } = await install();
  const { client, heldRun } = await startHeld(tools);
  client.send({ type: "closed" });
  const reply = tools.get("delegate_reply")!;
  await vi.waitFor(() =>
    expect(
      reply.execute("id", { text: "more" }, undefined, vi.fn(), session("atlas")),
    ).rejects.toThrow("run finished; start a new run with sessionId to continue"),
  );
  heldRun.resolve();
});

test("a request starts a turn and expired is shown without starting one", async () => {
  const { tools, sendMessage } = await install();
  const { client, heldRun } = await startHeld(tools);
  client.send({
    type: "request",
    id: "r-1",
    kind: "permission",
    tool: "Bash",
    input: { command: "npm i" },
    path: "/opt",
  });
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  expect(sendMessage.mock.calls[0][0]).toMatchObject({ customType: "delegate-request" });
  expect((sendMessage.mock.calls[0][0] as { content: string }).content).toContain("r-1");
  expect(sendMessage.mock.calls[0][1]).toEqual({ triggerTurn: true });
  client.send({ type: "expired", id: "r-1" });
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  expect(sendMessage.mock.calls[1][1]).toEqual({ triggerTurn: false });
  heldRun.resolve();
});

test("delegate_status reports progress, pending requests and the session id", async () => {
  const { tools } = await install();
  const { client, heldRun } = await startHeld(tools);
  heldRun.onUpdate?.({ content: [{ type: "text", text: "editing index.html" }] });
  client.send({ type: "request", id: "r-7", kind: "question", questions: [] });
  const status = tools.get("delegate_status")!;
  await vi.waitFor(async () => {
    const { content } = await status.execute("id", {}, undefined, vi.fn(), session("atlas"));
    expect(content[0].text).toContain("r-7");
  });
  const { content } = await status.execute("id", {}, undefined, vi.fn(), session("atlas"));
  expect(content[0].text).toContain("editing index.html");
  expect(content[0].text).toContain("s-1");
  heldRun.resolve();
});

test("delegate_stop sends stop and aborts the run if it has not settled within 10 s", async () => {
  const { tools } = await install();
  const { received, heldRun } = await startHeld(tools);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const stopping = tools
    .get("delegate_stop")!
    .execute("id", {}, undefined, vi.fn(), session("atlas"));
  await vi.waitFor(() => expect(received).toEqual([{ type: "stop" }]));
  expect(heldRun.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
  await stopping;
  expect(heldRun.signal.aborted).toBe(true);
});

test("the background run uses its own abort signal, not the tool call's", async () => {
  const { tools } = await install();
  hold();
  const controller = new AbortController();
  const call = tools
    .get("delegate")!
    .execute("id", { task: "x" }, controller.signal, vi.fn(), session("atlas"));
  await vi.waitFor(() => expect(held()).toHaveLength(1));
  await proxyFor(held()[0]);
  await call;
  controller.abort();
  expect(held()[0].signal.aborted).toBe(false);
  held()[0].resolve();
});

test("delegate, delegate_reply, delegate_status and delegate_stop are registered", async () => {
  const { tools } = await install();
  expect([...tools.keys()]).toEqual(
    expect.arrayContaining(["delegate", "delegate_reply", "delegate_status", "delegate_stop"]),
  );
});
