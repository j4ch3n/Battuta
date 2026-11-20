import { randomUUID } from "node:crypto";
import type { CanUseTool, PermissionResult, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProxyMessage, WorkerMessage } from "./delegate-channel.ts";

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
