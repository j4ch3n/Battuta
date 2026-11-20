import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPermissionGate,
  createSessionInput,
  parseClaudeArgs,
  runProxy,
  READONLY_DENIED_TOOLS,
  UNANSWERED_DENIAL,
} from "../claude-proxy.ts";
import { openChannel, type ChannelServer, type ProxyMessage } from "../delegate-channel.ts";
import type { CanUseTool, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

afterEach(() => {
  vi.useRealTimers();
});

type CanUseToolOptions = Parameters<CanUseTool>[2];
const opts = (extra: Partial<CanUseToolOptions> = {}) =>
  ({ signal: new AbortController().signal, toolUseID: "tool-1", ...extra }) as CanUseToolOptions;

async function take<T>(iterator: AsyncIterator<T>): Promise<T> {
  const next = await iterator.next();
  if (next.done) throw new Error("input ended");
  return next.value;
}

describe("createSessionInput", () => {
  test("the first prompt is yielded with a uuid", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    expect(first).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: "do the task" },
    });
    expect(first.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("the input stays open until every sent uuid appears in a result", async () => {
    const input = createSessionInput("do the task");
    const iterator = input.stream[Symbol.asyncIterator]();
    const first = await take(iterator);
    expect(input.send("also check the docs")).toBe(true);
    const second = await take(iterator);
    input.observeResult({ user_message_uuid: first.uuid, user_message_uuids: [first.uuid!] });
    expect(input.closed).toBe(false);
    input.observeResult({ user_message_uuids: [second.uuid!] });
    expect(input.closed).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  test("a pending request keeps the input open after the last result", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    input.setPending(1);
    input.observeResult({ user_message_uuids: [first.uuid!] });
    expect(input.closed).toBe(false);
    input.setPending(0);
    expect(input.closed).toBe(true);
  });

  test("pending requests alone never close an input with unanswered messages", async () => {
    const input = createSessionInput("do the task");
    await take(input.stream[Symbol.asyncIterator]());
    input.setPending(1);
    input.setPending(0);
    expect(input.closed).toBe(false);
  });

  test("sends after close return false", () => {
    const input = createSessionInput("do the task");
    const onClosed = vi.fn();
    input.onClosed(onClosed);
    input.close();
    expect(input.send("too late")).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  test("a result with only user_message_uuid counts", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    input.observeResult({ user_message_uuid: first.uuid });
    expect(input.closed).toBe(true);
  });
});

describe("createPermissionGate", () => {
  function gate(readonly: boolean, timeoutMs?: number) {
    const forwarded: ProxyMessage[] = [];
    const onPendingChange = vi.fn();
    const permissions = createPermissionGate({
      readonly,
      forward: (message) => forwarded.push(message),
      timeoutMs,
      onPendingChange,
    });
    return { permissions, forwarded, onPendingChange };
  }

  test.each(READONLY_DENIED_TOOLS.map((tool) => [tool]))(
    "a readonly run denies %s without asking the worker",
    async (tool) => {
      const { permissions, forwarded } = gate(true);
      const result = await permissions.canUseTool(tool, {}, opts());
      expect(result!.behavior).toBe("deny");
      expect(forwarded).toEqual([]);
    },
  );

  test("AskUserQuestion is forwarded as a question", () => {
    const { permissions, forwarded } = gate(true);
    const questions = [{ question: "Pick a colour", options: [] }];
    void permissions.canUseTool("AskUserQuestion", { questions }, opts());
    expect(forwarded).toEqual([
      { type: "request", id: expect.any(String) as string, kind: "question", questions },
    ]);
  });

  test("another tool is forwarded as a permission request with its blocked path", () => {
    const { permissions, forwarded } = gate(false);
    void permissions.canUseTool(
      "Bash",
      { command: "npm install" },
      opts({ blockedPath: "/opt/lib" }),
    );
    expect(forwarded).toEqual([
      {
        type: "request",
        id: expect.any(String) as string,
        kind: "permission",
        tool: "Bash",
        input: { command: "npm install" },
        path: "/opt/lib",
      },
    ]);
  });

  test("an allowing answer allows the tool call", async () => {
    const { permissions, forwarded } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "" });
    expect(await pending).toMatchObject({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  test("a refusing answer denies with the worker's text", async () => {
    const { permissions, forwarded } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "rm -rf x" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: false, text: "outside the commission" });
    expect(await pending).toEqual({ behavior: "deny", message: "outside the commission" });
  });

  test("an answer to AskUserQuestion puts the text into updatedInput.answers", async () => {
    const { permissions, forwarded } = gate(false);
    const questions = [{ question: "Pick a colour", options: [] }];
    const pending = permissions.canUseTool("AskUserQuestion", { questions }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "blue" });
    expect(await pending).toEqual({
      behavior: "allow",
      updatedInput: { questions, answers: { "Pick a colour": "blue" } },
    });
  });

  test("an unanswered request is denied with the fixed text after timeoutMs and forwards expired", async () => {
    vi.useFakeTimers();
    const { permissions, forwarded } = gate(false, 1000);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    const { id } = forwarded[0] as { id: string };
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ behavior: "deny", message: UNANSWERED_DENIAL });
    expect(forwarded[1]).toEqual({ type: "expired", id });
    expect(UNANSWERED_DENIAL).toBe(
      "no answer; continue with your best judgment and list it under open questions",
    );
  });

  test("the default limit for an unanswered request is 10 minutes", async () => {
    vi.useFakeTimers();
    const { permissions } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    await vi.advanceTimersByTimeAsync(599_999);
    expect(permissions.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)!.behavior).toBe("deny");
  });

  test("stop settles pending requests", async () => {
    const { permissions } = gate(false);
    const first = permissions.canUseTool("Bash", { command: "a" }, opts());
    const second = permissions.canUseTool("Bash", { command: "b" }, opts());
    permissions.denyAll("stopped by the worker");
    expect(await first).toEqual({ behavior: "deny", message: "stopped by the worker" });
    expect(await second).toEqual({ behavior: "deny", message: "stopped by the worker" });
    expect(permissions.pending).toBe(0);
  });

  test("an aborted request settles as denied", async () => {
    const { permissions } = gate(false);
    const controller = new AbortController();
    const pending = permissions.canUseTool(
      "Bash",
      { command: "a" },
      opts({ signal: controller.signal }),
    );
    controller.abort();
    expect((await pending)!.behavior).toBe("deny");
    expect(permissions.pending).toBe(0);
  });

  test("without forward every request is denied immediately", async () => {
    const permissions = createPermissionGate({ readonly: false, onPendingChange: vi.fn() });
    const result = await permissions.canUseTool("AskUserQuestion", { questions: [] }, opts());
    expect(result!.behavior).toBe("deny");
  });

  test("onPendingChange tracks the count", () => {
    const { permissions, forwarded, onPendingChange } = gate(false);
    void permissions.canUseTool("Bash", { command: "a" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "" });
    expect(onPendingChange.mock.calls).toEqual([[1], [0]]);
  });
});

const BUILT_ARGS = [
  "-p",
  "do the task",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--permission-mode",
  "acceptEdits",
  "--model",
  "claude-haiku-5-5",
  "--max-budget-usd",
  "2",
  "--add-dir",
  "/srv/a",
  "--add-dir",
  "/srv/b",
];

describe("parseClaudeArgs", () => {
  test("the arguments claude.ts buildArgs emits map to proxy options", () => {
    expect(parseClaudeArgs(BUILT_ARGS)).toEqual({
      prompt: "do the task",
      permissionMode: "acceptEdits",
      persistSession: true,
      model: "claude-haiku-5-5",
      maxBudgetUsd: 2,
      addDirs: ["/srv/a", "/srv/b"],
    });
  });

  test.each([
    [["--resume", "s-1"], { resume: "s-1", persistSession: true }],
    [["--no-session-persistence"], { persistSession: false }],
  ])("%j is honored", (extra, expected) => {
    expect(parseClaudeArgs(["-p", "x", "--permission-mode", "plan", ...extra])).toMatchObject(
      expected,
    );
  });

  test.each([
    [["-p", "x", "--permission-mode", "plan", "--dangerously-skip-permissions"]],
    [["-p", "x", "--permission-mode", "plan", "--output-format", "json"]],
    [["-p", "x", "--permission-mode", "plan", "--model"]],
    [["--permission-mode", "plan"]],
    [["-p", "x", "--permission-mode", "plan", "--max-budget-usd", "lots"]],
  ])("%j is refused", (argv) => {
    expect(() => parseClaudeArgs(argv)).toThrow("unsupported claude argument");
  });
});

/** A stand-in for the SDK's `query()`: replays scripted messages, which may wait on the session's input. */
function fakeQuery(
  script: (options: {
    input: AsyncIterator<SDKUserMessage>;
    canUseTool: CanUseTool;
  }) => AsyncGenerator<Record<string, unknown>>,
) {
  const calls: Record<string, unknown>[] = [];
  const interrupt = vi.fn();
  const query = ((params: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Record<string, unknown>;
  }) => {
    calls.push(params.options);
    const generator = script({
      input: params.prompt[Symbol.asyncIterator](),
      canUseTool: params.options.canUseTool as CanUseTool,
    });
    return Object.assign(generator, {
      interrupt: async () => {
        interrupt();
        await generator.return(undefined);
      },
    });
  }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
  return { query, calls, interrupt };
}

const init = (sessionId = "s-1") => ({ type: "system", subtype: "init", session_id: sessionId });
const result = (uuid: string | undefined, extra: object = {}) => ({
  type: "result",
  subtype: "success",
  session_id: "s-1",
  result: "done",
  user_message_uuid: uuid,
  user_message_uuids: uuid ? [uuid] : [],
  ...extra,
});

describe("runProxy", () => {
  let server: ChannelServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function worker() {
    const messages: ProxyMessage[] = [];
    const disconnected = vi.fn();
    server = await openChannel({
      onMessage: (message) => messages.push(message),
      onDisconnect: disconnected,
    });
    server.expect("token-1");
    const env = { BATTUTA_DELEGATE_SOCKET: server.path, BATTUTA_DELEGATE_TOKEN: "token-1" };
    return { server, messages, env, disconnected };
  }

  async function run(
    query: typeof import("@anthropic-ai/claude-agent-sdk").query,
    env: NodeJS.ProcessEnv = {},
    argv = BUILT_ARGS,
  ) {
    const lines: string[] = [];
    const errors: string[] = [];
    const code = await runProxy({
      argv,
      env,
      cwd: "/srv/work",
      query,
      write: (line) => lines.push(line),
      error: (line) => errors.push(line),
    });
    return { code, lines, errors };
  }

  const answerOnce = async function* ({ input }: { input: AsyncIterator<SDKUserMessage> }) {
    const first = (await input.next()).value as SDKUserMessage;
    yield init();
    yield result(first.uuid);
  };

  test("query receives the run options and the claude executable on PATH", async () => {
    const { query, calls } = fakeQuery(answerOnce);
    await run(query, {}, [...BUILT_ARGS, "--resume", "s-0"]);
    expect(calls[0]).toMatchObject({
      cwd: "/srv/work",
      permissionMode: "acceptEdits",
      model: "claude-haiku-5-5",
      maxBudgetUsd: 2,
      resume: "s-0",
      persistSession: true,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: "claude",
    });
  });

  test("additionalDirectories is the --add-dir values plus BATTUTA_DELEGATE_DIRS", async () => {
    const { query, calls } = fakeQuery(answerOnce);
    await run(query, { BATTUTA_DELEGATE_DIRS: JSON.stringify(["/tmp", "/srv/code"]) });
    expect(calls[0].additionalDirectories).toEqual(["/srv/a", "/srv/b", "/tmp", "/srv/code"]);
  });

  test("each SDK message is written as one JSON line", async () => {
    const { query } = fakeQuery(answerOnce);
    const { code, lines } = await run(query);
    expect(code).toBe(0);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      init(),
      expect.objectContaining({ type: "result", result: "done" }),
    ]);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });

  test("started is sent once with the session id from the first system/init", async () => {
    const { messages, env } = await worker();
    const { query } = fakeQuery(async function* ({ input }) {
      const first = (await input.next()).value as SDKUserMessage;
      yield init("s-9");
      yield init("s-9");
      yield result(first.uuid);
    });
    await run(query, env);
    await vi.waitFor(() => expect(messages.some((m) => m.type === "started")).toBe(true));
    expect(messages.filter((message) => message.type === "started")).toEqual([
      { type: "started", sessionId: "s-9" },
    ]);
  });

  test("a question reaches the worker and its answer reaches Claude", async () => {
    const { server, messages, env } = await worker();
    let answer: unknown;
    const { query } = fakeQuery(async function* ({ input, canUseTool }) {
      const first = (await input.next()).value as SDKUserMessage;
      yield init();
      answer = await canUseTool(
        "AskUserQuestion",
        { questions: [{ question: "Which folder?" }] },
        opts(),
      );
      yield result(first.uuid);
    });
    const running = run(query, env);
    await vi.waitFor(() => expect(messages.some((m) => m.type === "request")).toBe(true));
    const request = messages.find((m) => m.type === "request") as { id: string };
    server.send({ type: "answer", id: request.id, allow: true, text: "the work folder" });
    expect((await running).code).toBe(0);
    expect(answer).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Which folder?": "the work folder" } },
    });
  });

  test("guide messages become user messages answered before the input closes", async () => {
    const { server, messages, env } = await worker();
    const seen: string[] = [];
    const { query } = fakeQuery(async function* ({ input }) {
      const first = (await input.next()).value as SDKUserMessage;
      seen.push(first.message.content as string);
      yield init();
      await vi.waitFor(() => expect(messages.some((m) => m.type === "started")).toBe(true));
      server.send({ type: "guide", text: "also update the docs" });
      const second = (await input.next()).value as SDKUserMessage;
      seen.push(second.message.content as string);
      yield result(first.uuid);
      yield result(second.uuid);
      expect((await input.next()).done).toBe(true);
    });
    expect((await run(query, env)).code).toBe(0);
    expect(seen).toEqual(["do the task", "also update the docs"]);
    await vi.waitFor(() => expect(messages.at(-1)).toEqual({ type: "closed" }));
  });

  test("stop interrupts the run and denies pending requests", async () => {
    const { server, messages, env } = await worker();
    let denied: unknown;
    const { query, interrupt } = fakeQuery(async function* ({ input, canUseTool }) {
      await input.next();
      yield init();
      denied = await canUseTool("Bash", { command: "npm test" }, opts());
      yield init();
    });
    const running = run(query, env);
    await vi.waitFor(() => expect(messages.some((m) => m.type === "request")).toBe(true));
    server.send({ type: "stop" });
    await running;
    expect(interrupt).toHaveBeenCalled();
    expect(denied).toEqual({ behavior: "deny", message: "stopped by the worker" });
  });

  test("a dropped socket interrupts the query and returns non-zero", async () => {
    const { server, env } = await worker();
    const { query, interrupt } = fakeQuery(async function* ({ input }) {
      await input.next();
      yield init();
      await server.close();
      await input.next();
    });
    const { code } = await run(query, env);
    expect(interrupt).toHaveBeenCalled();
    expect(code).not.toBe(0);
  });

  test("without BATTUTA_DELEGATE_SOCKET every request is denied and the run completes", async () => {
    let decision: unknown;
    const { query } = fakeQuery(async function* ({ input, canUseTool }) {
      const first = (await input.next()).value as SDKUserMessage;
      decision = await canUseTool("AskUserQuestion", { questions: [] }, opts());
      yield result(first.uuid);
    });
    expect((await run(query)).code).toBe(0);
    expect(decision).toMatchObject({ behavior: "deny" });
  });

  test("a query error is written to stderr and returns 1", async () => {
    // eslint-disable-next-line require-yield
    const { query } = fakeQuery(async function* () {
      await Promise.resolve();
      throw new Error("claude exited with code 1");
    });
    const { code, errors } = await run(query);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("claude exited with code 1");
  });
});
