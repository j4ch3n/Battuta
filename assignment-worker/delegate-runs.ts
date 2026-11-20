import { randomBytes } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openChannel, type ChannelServer, type ProxyMessage } from "./delegate-channel.ts";

export const RUN_ACTIVE = "a run is active; use delegate_status, delegate_reply or delegate_stop";
export const RUN_FINISHED = "run finished; start a new run with sessionId to continue";
const NO_RUN = "No Claude run is active.";

export interface SessionRecord {
  assignment_id: string;
  cwd: string;
  state: "running" | "finished";
}

/**
 * The Claude sessions this Pi session started, from its `delegate-run` entries: the `running` entry carries the
 * assignment and folder, a later `finished` entry only the state.
 */
export function sessionRecords(
  ctx: Pick<ExtensionContext, "sessionManager">,
): Map<string, SessionRecord> {
  const records = new Map<string, SessionRecord>();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== "delegate-run") continue;
    const data = entry.data as Partial<SessionRecord> & { sessionId?: unknown };
    if (typeof data.sessionId !== "string") continue;
    const state = data.state === "finished" ? "finished" : "running";
    const known = records.get(data.sessionId);
    if (typeof data.assignment_id === "string" && typeof data.cwd === "string")
      records.set(data.sessionId, { assignment_id: data.assignment_id, cwd: data.cwd, state });
    else if (known) known.state = state;
  }
  return records;
}

/** A notice for the worker when the last Claude run of this session never finished (the worker restarted). */
export function interruptedNotice(
  ctx: Pick<ExtensionContext, "sessionManager">,
): string | undefined {
  const last = [...sessionRecords(ctx)].at(-1);
  if (!last || last[1].state !== "running") return undefined;
  return `Previous Claude run (session ${last[0]}) was interrupted; resume it with sessionId: ${last[0]} or start a new run.`;
}

/** What a Pi tool returns: the package's result shape. */
export type ToolResult = { content: { type: "text"; text: string }[]; details?: unknown };

type Request = Extract<ProxyMessage, { type: "request" }>;

interface Run {
  assignmentId: string;
  cwd: string;
  sessionId?: string;
  startedAt: number;
  controller: AbortController;
  pending: Map<string, Request>;
  progress?: string;
  inputClosed: boolean;
  settled: Promise<unknown>;
  onStarted(): void;
}

export interface DelegateRuns {
  readonly active: boolean;
  /**
   * Starts `execute` in the background and resolves once Claude has started (or after a short wait). A run
   * that settles before that returns its result, or throws its error, directly. Throws when a run is active.
   */
  start(run: {
    assignmentId: string;
    cwd: string;
    dirs: string[];
    execute: (signal: AbortSignal, onUpdate: (partial: unknown) => void) => Promise<ToolResult>;
  }): Promise<ToolResult>;
  reply(params: { text: string; requestId?: string; allow?: boolean }): string;
  status(): string;
  stop(): Promise<string>;
  close(): Promise<void>;
}

const ENV_KEYS = ["BATTUTA_DELEGATE_SOCKET", "BATTUTA_DELEGATE_TOKEN", "BATTUTA_DELEGATE_DIRS"];

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });

function textOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
  return (content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
}

function describeRequest(request: Request): string {
  const how = `Answer with delegate_reply and requestId "${request.id}".`;
  if (request.kind === "question")
    return `Claude asks (request ${request.id}):\n${JSON.stringify(request.questions, null, 2)}\n${how}`;
  const where = request.path ? ` outside the allowed folders (${request.path})` : "";
  return `Claude requests permission (request ${request.id}) to use ${request.tool}${where}:\n${JSON.stringify(request.input, null, 2)}\n${how} Set allow to false to deny.`;
}

/**
 * One background Claude run at a time for this worker, and the socket its proxy reports to. Questions and
 * permission requests reach the worker as turn-starting messages; so does the run's result.
 */
export async function createDelegateRuns(
  pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">,
  { startWaitMs = 30_000, stopGraceMs = 10_000 } = {},
): Promise<DelegateRuns> {
  let current: Run | undefined;

  const notify = (customType: string, content: string, triggerTurn: boolean) =>
    pi.sendMessage({ customType, content, display: true }, { triggerTurn });

  const channel: ChannelServer = await openChannel({
    onMessage(message) {
      const run = current;
      if (!run) return;
      if (message.type === "started") {
        run.sessionId = message.sessionId;
        pi.appendEntry("delegate-run", {
          sessionId: message.sessionId,
          assignment_id: run.assignmentId,
          cwd: run.cwd,
          state: "running",
        });
        run.onStarted();
      } else if (message.type === "request") {
        run.pending.set(message.id, message);
        notify("delegate-request", describeRequest(message), true);
      } else if (message.type === "expired") {
        run.pending.delete(message.id);
        notify(
          "delegate-request",
          `Request ${message.id} went unanswered and was denied; Claude continues and lists it as an open question.`,
          false,
        );
      } else if (message.type === "closed") run.inputClosed = true;
    },
    onDisconnect() {},
  });

  const sleep = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<"timeout">(
      (resolve) => (timer = setTimeout(() => resolve("timeout"), ms)),
    );
    return { done, cancel: () => clearTimeout(timer) };
  };

  function cleanup(run: Run) {
    for (const key of ENV_KEYS) delete process.env[key];
    channel.expect(null);
    if (run.sessionId)
      pi.appendEntry("delegate-run", { sessionId: run.sessionId, state: "finished" });
    if (current === run) current = undefined;
  }

  return {
    get active() {
      return current !== undefined;
    },

    async start({ assignmentId, cwd, dirs, execute }) {
      if (current) throw new Error(RUN_ACTIVE);
      const token = randomBytes(16).toString("hex");
      channel.expect(token);
      // One run per worker, so the proxy the package spawns for it inherits exactly these.
      process.env.BATTUTA_DELEGATE_SOCKET = channel.path;
      process.env.BATTUTA_DELEGATE_TOKEN = token;
      process.env.BATTUTA_DELEGATE_DIRS = JSON.stringify(dirs);
      let onStarted = () => {};
      const started = new Promise<"started">((resolve) => (onStarted = () => resolve("started")));
      const run: Run = {
        assignmentId,
        cwd,
        startedAt: Date.now(),
        controller: new AbortController(),
        pending: new Map(),
        inputClosed: false,
        settled: Promise.resolve(),
        onStarted,
      };
      current = run;
      const outcome = execute(run.controller.signal, (partial) => {
        const latest = textOf(partial);
        if (latest) run.progress = latest.slice(-2000);
      }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      run.settled = outcome;
      const wait = sleep(startWaitMs);
      const winner = await Promise.race([
        started,
        outcome.then(() => "settled" as const),
        wait.done,
      ]);
      wait.cancel();
      if (winner === "settled") {
        cleanup(run);
        const settled = await outcome;
        if (settled.ok) return settled.result;
        throw settled.error;
      }
      void outcome.then((settled) => {
        cleanup(run);
        const session = run.sessionId ? ` (session ${run.sessionId})` : "";
        if (settled.ok)
          notify(
            "delegate-run",
            `Claude run finished${session}:\n\n${textOf(settled.result)}`,
            true,
          );
        else {
          const reason =
            settled.error instanceof Error ? settled.error.message : String(settled.error);
          notify("delegate-run", `Claude run failed${session}: ${reason}`, true);
        }
      });
      const session = run.sessionId ? `session ${run.sessionId}` : "session id not reported yet";
      return text(
        `Claude run started in ${cwd} (${session}). Questions and the result arrive as messages; use delegate_status, delegate_reply or delegate_stop meanwhile.`,
      );
    },

    reply({ text: answer, requestId, allow }) {
      const run = current;
      if (!run) throw new Error(NO_RUN);
      if (requestId !== undefined) {
        if (!run.pending.has(requestId)) throw new Error(`no pending request ${requestId}`);
        if (!channel.send({ type: "answer", id: requestId, allow: allow ?? true, text: answer }))
          throw new Error("the Claude run is not connected");
        run.pending.delete(requestId);
        return `Answer sent for request ${requestId}.`;
      }
      if (run.inputClosed) throw new Error(RUN_FINISHED);
      if (!channel.send({ type: "guide", text: answer }))
        throw new Error("the Claude run is not connected");
      return "Guidance sent to the running Claude session.";
    },

    status() {
      const run = current;
      if (!run) return NO_RUN;
      const minutes = Math.round((Date.now() - run.startedAt) / 60_000);
      const pending = [...run.pending.values()].map((request) => `- ${describeRequest(request)}`);
      return [
        `Claude run in ${run.cwd}, running ${minutes} min, session ${run.sessionId ?? "not reported yet"}.`,
        run.inputClosed ? "Its input is closed: it is finishing and takes no more guidance." : "",
        pending.length ? `Pending requests:\n${pending.join("\n")}` : "No pending requests.",
        run.progress ? `Latest progress:\n${run.progress}` : "No progress reported yet.",
      ]
        .filter(Boolean)
        .join("\n");
    },

    async stop() {
      const run = current;
      if (!run) return NO_RUN;
      channel.send({ type: "stop" });
      const grace = sleep(stopGraceMs);
      const winner = await Promise.race([run.settled.then(() => "settled" as const), grace.done]);
      grace.cancel();
      if (winner === "timeout") run.controller.abort();
      await run.settled;
      return "Claude run stopped.";
    },

    async close() {
      current?.controller.abort();
      await channel.close();
    },
  };
}
