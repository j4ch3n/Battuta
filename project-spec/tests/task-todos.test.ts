import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as discovery from "../store/discovery.ts";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerTaskTodos } from "../task-todos.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "todos-"));
  roots.push(root);
  for (const name of ["alpha", "beta"]) await mkdir(join(root, name));
  await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "alpha" }));
  return root;
}
function harness(root: string, role: "pm" | "tl" = "pm", session = SessionManager.inMemory()) {
  let tool: ToolDefinition;
  let before: (event: unknown, ctx: ExtensionContext) => Promise<unknown>;
  const pi = {
    registerTool(value: ToolDefinition) {
      tool = value;
    },
    appendEntry(type: string, data: unknown) {
      session.appendCustomEntry(type, data);
    },
    on(name: string, handler: typeof before) {
      if (name === "before_agent_start") before = handler;
    },
  } as unknown as ExtensionAPI;
  registerTaskTodos(pi, role, root);
  const ctx = { sessionManager: session } as unknown as ExtensionToolContext;
  return {
    session,
    call: (args: Record<string, unknown>, signal?: AbortSignal) =>
      tool.execute("call", args, signal, undefined, ctx),
    context: () => before({}, ctx),
  };
}
const add = (text = "Research", revision = 0, task = "request-1") => ({
  action: "add",
  task,
  text,
  revision,
});
const update = (status: string, extra = {}) => ({
  action: "update",
  task: "request-1",
  id: 1,
  revision: 1,
  status,
  ...extra,
});

test.each(["Atlas", "atlas.api", "Atlas API", "a".repeat(65)])(
  "registered project name %s survives mutation and recovery",
  async (name) => {
    const root = await fixture();
    await mkdir(join(root, name));
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: name }));
    const h = harness(root);
    expect((await h.call(add())).details).toMatchObject({ project: name, revision: 1 });
    const resumed = harness(root, "pm", h.session);
    expect((await resumed.call({ action: "list", task: "request-1" })).details).toMatchObject({
      project: name,
      revision: 1,
      items: [{ id: 1, text: "Research" }],
    });
    expect((await resumed.call(update("in-progress"))).details).toMatchObject({
      project: name,
      revision: 2,
    });
  },
);

function holdSelection() {
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const original = discovery.projectDirectory;
  vi.spyOn(discovery, "projectDirectory").mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    started();
    await held;
    return result;
  });
  return { entered, release };
}

test("immediate abort prevents queued add from appending state", async () => {
  const h = harness(await fixture());
  const abort = new AbortController();
  const pending = h.call(add(), abort.signal);
  abort.abort();
  expect((await pending).isError).toBe(true);
  expect(h.session.getBranch()).toHaveLength(0);
  expect((await h.call(add())).details).toMatchObject({ revision: 1 });
});

test("abort during awaited project selection prevents mutation and append", async () => {
  const h = harness(await fixture());
  const gate = holdSelection();
  const abort = new AbortController();
  const pending = h.call(add(), abort.signal);
  await gate.entered;
  abort.abort();
  gate.release();
  expect((await pending).isError).toBe(true);
  expect(h.session.getBranch()).toHaveLength(0);
  expect((await h.call(add())).details).toMatchObject({ revision: 1 });
});

test.each(["completed", "cancelled"])(
  "aborted %s waiting behind another call cannot append or advance revision",
  async (status) => {
    const h = harness(await fixture());
    await h.call(add());
    const entries = h.session.getBranch().length;
    const gate = holdSelection();
    const first = h.call({ action: "list", task: "request-1" });
    await gate.entered;
    const abort = new AbortController();
    const waiting = h.call(
      update(status, { outcome: "Done", verification: "reference" }),
      abort.signal,
    );
    abort.abort();
    gate.release();
    await first;
    expect((await waiting).isError).toBe(true);
    expect(h.session.getBranch()).toHaveLength(entries);
    expect((await h.call({ action: "list", task: "request-1" })).details).toMatchObject({
      revision: 1,
      items: [{ status: "pending" }],
    });
    expect((await h.call(update("in-progress"))).details).toMatchObject({ revision: 2 });
  },
);

test("stable IDs, explicit states, retained blocker and completion evidence", async () => {
  const h = harness(await fixture());
  const first = await h.call(add());
  expect(first.details).toMatchObject({ revision: 1, items: [{ id: 1, status: "pending" }] });
  await h.call(update("blocked", { reason: "Need access", nextAction: "Ask owner" }));
  await h.call(update("in-progress", { revision: 2 }));
  const done = await h.call(
    update("completed", {
      revision: 3,
      outcome: "Compared options",
      verification: "docs/research.md",
    }),
  );
  expect(done.details).toMatchObject({
    revision: 4,
    items: [
      {
        status: "completed",
        reason: "Need access",
        nextAction: "Ask owner",
        outcome: "Compared options",
        verification: "docs/research.md",
      },
    ],
  });
  const second = await h.call(add("Deliver", 4));
  expect(second.details).toMatchObject({ items: [{ id: 1 }, { id: 2 }] });
  const cancelled = await h.call({
    action: "update",
    task: "request-1",
    id: 2,
    revision: 5,
    status: "cancelled",
  });
  expect(cancelled.details).toMatchObject({ items: [{ id: 1 }, { id: 2, status: "cancelled" }] });
});

test.each([
  update("blocked"),
  update("blocked", { reason: "Waiting" }),
  update("completed"),
  update("completed", { outcome: "Done" }),
  update("unknown"),
  update("pending", { id: 9 }),
  update("pending", { id: -1 }),
  update("pending", { revision: 0 }),
  add(" ", 1),
  add("x".repeat(501), 1),
  add("x", 1, "x".repeat(81)),
  { action: "add", task: "request-1", text: "Missing revision" },
])("invalid mutation is rejected without advancing revision: %j", async (args) => {
  const h = harness(await fixture());
  await h.call(add());
  expect(await h.call(args)).toMatchObject({ isError: true });
  expect((await h.call({ action: "list", task: "request-1" })).details).toMatchObject({
    revision: 1,
    items: [{ id: 1, status: "pending" }],
  });
});

test("concurrent stale writes cannot overwrite each other before tool results are appended", async () => {
  const h = harness(await fixture());
  await h.call(add());
  const results = await Promise.all([h.call(update("in-progress")), h.call(update("cancelled"))]);
  expect(results.filter((r) => r.isError)).toHaveLength(1);
  expect((await h.call({ action: "list", task: "request-1" })).details).toMatchObject({
    revision: 2,
    items: [{ status: "in-progress" }],
  });
});

test("reconstructs restart, compaction, rewind and task/project/bot isolation", async () => {
  const root = await fixture();
  const h = harness(root);
  await h.call(add());
  const leaf = h.session.getLeafId()!;
  await h.call(update("in-progress"));
  h.session.appendCompaction("summary omits todos", leaf, 100);
  expect(
    (await harness(root, "pm", h.session).call({ action: "list", task: "request-1" })).details,
  ).toMatchObject({ revision: 2 });
  h.session.branch(leaf);
  expect((await h.call({ action: "list", task: "request-1" })).details).toMatchObject({
    revision: 1,
    items: [{ status: "pending" }],
  });
  await h.call(add("Other task", 0, "request-2"));
  expect((await h.call({ action: "tasks" })).details).toMatchObject({
    tasks: ["request-1", "request-2"],
  });
  expect((await harness(root, "tl", h.session).call({ action: "tasks" })).details).toMatchObject({
    tasks: [],
  });
  await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "beta" }));
  expect((await h.call({ action: "tasks" })).details).toMatchObject({ tasks: [] });
  await h.call(add("Beta"));
  await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "alpha" }));
  expect((await h.call({ action: "list", task: "request-1" })).details).toMatchObject({
    items: [{ text: "Research" }],
  });
  expect(await h.context()).toBeDefined();
  expect((await harness(root).call({ action: "tasks" })).details).toMatchObject({ tasks: [] });
});

test("tool-result details alone recover and malformed details are ignored", async () => {
  const root = await fixture();
  const h = harness(root);
  const result = await h.call(add());
  const next = harness(root);
  next.session.appendMessage({
    role: "toolResult",
    toolCallId: "a",
    toolName: "task_todos",
    content: result.content,
    details: result.details as Record<string, string>,
    isError: false,
    timestamp: 1,
  });
  next.session.appendCustomEntry("battuta-task-todos", { version: 1, revision: 999 });
  expect((await next.call({ action: "list", task: "request-1" })).details).toMatchObject({
    revision: 1,
    items: [{ text: "Research" }],
  });
});

test("disk restart restores snapshots and an older delayed result cannot roll back progress", async () => {
  const root = await fixture();
  const session = SessionManager.create(root, join(root, "sessions"));
  session.appendMessage({ role: "user", content: "Assess imports", timestamp: 1 });
  const h = harness(root, "pm", session);
  const earlier = await h.call(add());
  await h.call(update("blocked", { reason: "No fixture", nextAction: "Request fixture" }));
  session.appendMessage({
    role: "toolResult",
    toolCallId: "late",
    toolName: "task_todos",
    content: earlier.content,
    details: earlier.details as Record<string, string>,
    isError: false,
    timestamp: 2,
  });
  const file = session.getSessionFile()!;
  const resumed = harness(root, "pm", SessionManager.open(file));
  expect((await resumed.call({ action: "list", task: "request-1" })).details).toMatchObject({
    revision: 2,
    items: [{ status: "blocked", reason: "No fixture", nextAction: "Request fixture" }],
  });
});

test("text edits retain ID and every repeated completion requires fresh evidence", async () => {
  const h = harness(await fixture());
  await h.call(add());
  const edited = await h.call({
    action: "update",
    task: "request-1",
    revision: 1,
    id: 1,
    text: "Inspect API",
  });
  expect(edited.details).toMatchObject({
    revision: 2,
    items: [{ id: 1, text: "Inspect API", status: "pending" }],
  });
  await h.call(
    update("completed", { revision: 2, outcome: "Inspected", verification: "API reference" }),
  );
  await h.call(update("in-progress", { revision: 3 }));
  expect((await h.call(update("completed", { revision: 4 }))).isError).toBe(true);
});

test("task discovery returns an inventory rather than dumping every task's full payload", async () => {
  const h = harness(await fixture());
  await h.call(add("Large detailed research notes"));
  const tasks = await h.call({ action: "tasks" });
  expect(tasks.details).toEqual({ tasks: ["request-1"] });
  expect(
    tasks.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  ).not.toContain("Large detailed research notes");
});

test("reading a missing task does not create a task or consume a task slot", async () => {
  const h = harness(await fixture());
  const empty = await h.call({ action: "list", task: "not-created" });
  h.session.appendMessage({
    role: "toolResult",
    toolCallId: "read",
    toolName: "task_todos",
    content: empty.content,
    details: empty.details as Record<string, string>,
    isError: false,
    timestamp: 1,
  });
  expect((await h.call({ action: "tasks" })).details).toEqual({ tasks: [] });
});

test("bounded lists reject the 51st item and 65th task without losing prior work", async () => {
  const h = harness(await fixture());
  for (let n = 0; n < 50; n++) expect((await h.call(add(`Step ${n}`, n))).isError).not.toBe(true);
  expect((await h.call(add("Overflow", 50))).isError).toBe(true);
  for (let n = 2; n <= 64; n++) await h.call(add("Step", 0, `request-${n}`));
  expect((await h.call(add("Overflow", 0, "request-65"))).isError).toBe(true);
});

test.each(["{}", "{broken", '{"currentProject":"../alpha"}', '{"currentProject":"absent"}'])(
  "invalid selected project fails closed: %s",
  async (config) => {
    const root = await fixture();
    await writeFile(join(root, ".config.json"), config);
    const h = harness(root);
    expect((await h.call(add())).isError).toBe(true);
    expect(await h.context()).toBeUndefined();
  },
);
