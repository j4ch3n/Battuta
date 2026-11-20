import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  query as sdkQuery,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  connectChannel,
  type ChannelClient,
  type ProxyMessage,
  type WorkerMessage,
} from "./delegate-channel.ts";

/** Tools a readonly (`plan`) run may never use, whatever the worker answers. */
export const READONLY_DENIED_TOOLS = ["Edit", "Write", "NotebookEdit", "ExitPlanMode"] as const;

export const UNANSWERED_DENIAL =
  "no answer; continue with your best judgment and list it under open questions";

const UNANSWERED_LIMIT_MS = 600_000;

export interface SessionInput {
  stream: AsyncIterable<SDKUserMessage>;
  /** Queues a user message; returns false once the input is closed. */
  send(text: string): boolean;
  /** Call with every `result` message; closes the input when all sends are answered and nothing is pending. */
  observeResult(result: { user_message_uuid?: string; user_message_uuids?: string[] }): void;
  setPending(count: number): void;
  close(): void;
  readonly closed: boolean;
  onClosed(handler: () => void): void;
}

/**
 * The streaming input of one Claude session. Claude keeps a streaming session open until its input ends, so the
 * input ends itself once every message sent has been answered by a `result` and no request awaits the worker.
 */
export function createSessionInput(firstPrompt: string): SessionInput {
  const queue: SDKUserMessage[] = [];
  const unanswered = new Set<string>();
  const closedHandlers: (() => void)[] = [];
  let pending = 0;
  let answeredOnce = false;
  let closed = false;
  let wake: (() => void) | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    wake?.();
    for (const handler of closedHandlers) handler();
  };
  const closeWhenDone = () => {
    if (answeredOnce && unanswered.size === 0 && pending === 0) close();
  };
  const send = (text: string) => {
    if (closed) return false;
    const uuid = randomUUID();
    unanswered.add(uuid);
    queue.push({
      type: "user",
      uuid,
      session_id: "",
      parent_tool_use_id: null,
      message: { role: "user", content: text },
    });
    wake?.();
    return true;
  };
  send(firstPrompt);

  async function* stream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (closed) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }

  return {
    stream: stream(),
    send,
    observeResult(result) {
      answeredOnce = true;
      for (const uuid of result.user_message_uuids ??
        (result.user_message_uuid ? [result.user_message_uuid] : []))
        unanswered.delete(uuid);
      closeWhenDone();
    },
    setPending(count) {
      pending = count;
      closeWhenDone();
    },
    close,
    get closed() {
      return closed;
    },
    onClosed: (handler) => void closedHandlers.push(handler),
  };
}

export interface PermissionGate {
  canUseTool: CanUseTool;
  answer(message: Extract<WorkerMessage, { type: "answer" }>): void;
  /** Deny every pending request (stop, socket loss). */
  denyAll(message: string): void;
  readonly pending: number;
}

/**
 * Decides Claude's permission requests and questions: readonly runs never write, everything else goes to the
 * worker and waits for its answer, up to a time limit after which it is denied. Without a worker (`forward`
 * undefined) every request is denied at once, as `claude -p` does.
 */
export function createPermissionGate(options: {
  readonly: boolean;
  forward?: (message: Extract<ProxyMessage, { type: "request" | "expired" }>) => void;
  timeoutMs?: number;
  onPendingChange(count: number): void;
}): PermissionGate {
  const waiting = new Map<
    string,
    { settle(result: PermissionResult): void; tool: string; input: Record<string, unknown> }
  >();
  const settle = (id: string, result: PermissionResult) => {
    const request = waiting.get(id);
    if (!request) return;
    waiting.delete(id);
    request.settle(result);
    options.onPendingChange(waiting.size);
  };

  const canUseTool: CanUseTool = async (tool, input, { signal, blockedPath }) => {
    if (options.readonly && (READONLY_DENIED_TOOLS as readonly string[]).includes(tool))
      return { behavior: "deny", message: "this run is read-only" };
    const forward = options.forward;
    if (!forward)
      return { behavior: "deny", message: "no worker is supervising this run to approve it" };
    const id = randomUUID();
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        settle(id, { behavior: "deny", message: UNANSWERED_DENIAL });
        forward({ type: "expired", id });
      }, options.timeoutMs ?? UNANSWERED_LIMIT_MS);
      const onAbort = () => settle(id, { behavior: "deny", message: "request cancelled" });
      waiting.set(id, {
        tool,
        input,
        settle(result) {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
      });
      signal.addEventListener("abort", onAbort, { once: true });
      options.onPendingChange(waiting.size);
      forward(
        tool === "AskUserQuestion"
          ? { type: "request", id, kind: "question", questions: input.questions }
          : {
              type: "request",
              id,
              kind: "permission",
              tool,
              input,
              ...(blockedPath ? { path: blockedPath } : {}),
            },
      );
    });
  };

  return {
    canUseTool,
    answer({ id, allow, text }) {
      const request = waiting.get(id);
      if (!request) return;
      if (!allow) return settle(id, { behavior: "deny", message: text || "denied by the worker" });
      if (request.tool !== "AskUserQuestion")
        return settle(id, { behavior: "allow", updatedInput: request.input });
      // One answer covers every question asked; Claude reads it back in the tool result.
      const questions = Array.isArray(request.input.questions) ? request.input.questions : [];
      const answers = Object.fromEntries(
        questions.map((question: { question?: unknown }) => [String(question.question), text]),
      );
      settle(id, { behavior: "allow", updatedInput: { ...request.input, answers } });
    },
    denyAll(message) {
      for (const id of [...waiting.keys()]) settle(id, { behavior: "deny", message });
    },
    get pending() {
      return waiting.size;
    },
  };
}

export interface ProxyArgs {
  prompt: string;
  permissionMode: string;
  resume?: string;
  persistSession: boolean;
  model?: string;
  maxBudgetUsd?: number;
  addDirs: string[];
}

/** The fixed `stream-json` flags `claude -p` gets from the package; the proxy always streams them. */
const STREAMING_FLAGS = new Set(["--verbose", "--include-partial-messages"]);

/** Parses exactly the arguments pi-harness-delegate's claude `buildArgs` emits; throws on anything else. */
export function parseClaudeArgs(argv: string[]): ProxyArgs {
  const unsupported = (arg: string | undefined): never => {
    throw new Error(`unsupported claude argument: ${arg ?? "(missing value)"}`);
  };
  const parsed: Partial<ProxyArgs> & { addDirs: string[]; persistSession: boolean } = {
    addDirs: [],
    persistSession: true,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => argv[++index] ?? unsupported(undefined);
    if (STREAMING_FLAGS.has(arg)) continue;
    else if (arg === "-p") parsed.prompt = value();
    else if (arg === "--output-format") {
      if (value() !== "stream-json") unsupported(arg);
    } else if (arg === "--permission-mode") parsed.permissionMode = value();
    else if (arg === "--resume") parsed.resume = value();
    else if (arg === "--no-session-persistence") parsed.persistSession = false;
    else if (arg === "--model") parsed.model = value();
    else if (arg === "--add-dir") parsed.addDirs.push(value());
    else if (arg === "--max-budget-usd") {
      const budget = Number(value());
      if (!Number.isFinite(budget)) unsupported(arg);
      parsed.maxBudgetUsd = budget;
    } else unsupported(arg);
  }
  if (parsed.prompt === undefined || parsed.permissionMode === undefined) unsupported("-p");
  return parsed as ProxyArgs;
}

function delegateDirs(env: NodeJS.ProcessEnv): string[] {
  if (!env.BATTUTA_DELEGATE_DIRS) return [];
  const dirs: unknown = JSON.parse(env.BATTUTA_DELEGATE_DIRS);
  if (!Array.isArray(dirs) || !dirs.every((dir) => typeof dir === "string"))
    throw new Error("BATTUTA_DELEGATE_DIRS must be a JSON array of paths");
  return dirs;
}

/**
 * Runs one delegated Claude session in place of `claude -p`: the same arguments in, the same `stream-json`
 * lines out, while questions and permission requests go to the supervising worker over its socket and the
 * worker's answers, guidance and stop come back. Returns the exit code.
 */
export async function runProxy(options: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  query: typeof sdkQuery;
  write(line: string): void;
  error(line: string): void;
}): Promise<number> {
  let channel: ChannelClient | undefined;
  try {
    const args = parseClaudeArgs(options.argv);
    const dirs = delegateDirs(options.env);
    const { BATTUTA_DELEGATE_SOCKET: socket, BATTUTA_DELEGATE_TOKEN: token } = options.env;
    if (socket && token) channel = await connectChannel(socket, token);
    const input = createSessionInput(args.prompt);
    const gate = createPermissionGate({
      readonly: args.permissionMode === "plan",
      forward: channel && ((message) => channel!.send(message)),
      onPendingChange: (count) => input.setPending(count),
    });
    const run = options.query({
      prompt: input.stream,
      options: {
        cwd: options.cwd,
        permissionMode: args.permissionMode as PermissionMode,
        model: args.model,
        maxBudgetUsd: args.maxBudgetUsd,
        resume: args.resume,
        persistSession: args.persistSession,
        additionalDirectories: [...args.addDirs, ...dirs],
        includePartialMessages: true,
        pathToClaudeCodeExecutable: "claude",
        canUseTool: gate.canUseTool,
      },
    });
    let finished = false;
    let lost = false;
    const end = (reason: string) => {
      gate.denyAll(reason);
      input.close();
      void run.interrupt().catch(() => undefined);
    };
    input.onClosed(() => channel?.send({ type: "closed" }));
    channel?.onMessage((message) => {
      if (message.type === "answer") gate.answer(message);
      else if (message.type === "guide") input.send(message.text);
      else if (message.type === "stop") end("stopped by the worker");
    });
    channel?.onClose(() => {
      if (finished) return;
      lost = true;
      end("the supervising worker disconnected");
    });
    let started = false;
    for await (const message of run) {
      options.write(JSON.stringify(message));
      if (!started && message.type === "system" && message.subtype === "init") {
        started = true;
        channel?.send({ type: "started", sessionId: message.session_id });
      }
      if (message.type === "result") input.observeResult(message);
    }
    finished = true;
    return lost ? 1 : 0;
  } catch (error) {
    options.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    channel?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await runProxy({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    query: sdkQuery,
    write: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  });
