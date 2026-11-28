import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createClient } from "@supabase/supabase-js";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { sendProgrammaticMail } from "@battuta/agent-mail/transport";
import { createAssignmentClient } from "./client.ts";
import { createAsk, type Ask } from "./ask.ts";
import { describeFailure } from "./errors.ts";
import { createHeartbeat, type Heartbeat } from "./heartbeat.ts";
import { delegationPromptSection } from "./delegation.ts";
import { createCoordinator } from "./coordinator.ts";
import { ExecutionResultParameters, currentBinding, parseAbilities } from "./contracts.ts";
import { guardWorktreeCommand } from "./worktree-guard.ts";
import { LONG_SLEEP, isLongSleep } from "./sleep-guard.ts";
import { registerProjectDelegate } from "./project-delegate.ts";
import { createNotifier } from "./notify.ts";
import { ensureAssignmentWorkspace } from "./workspace.ts";
import type {
  AssignmentClient,
  Coordinator,
  Detail,
  LifecycleSettings,
  RunTracker,
} from "./types.ts";

const ABORTED = "Execution was aborted before confirmed completion";
const AskParameters = Type.Object({
  objective: Type.String({
    minLength: 1,
    maxLength: 2000,
    description: "The question for the Manager, in one or two sentences.",
  }),
  body: Type.Optional(
    Type.String({ minLength: 1, maxLength: 4000, description: "Context the Manager needs." }),
  ),
  requirements: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), {
    minItems: 1,
    maxItems: 30,
    description: "What the answer must settle, one item each.",
  }),
});

export default async function worker(pi: ExtensionAPI) {
  let coordinator: Coordinator | undefined, client: AssignmentClient | undefined;
  let db: ReturnType<typeof createClient> | undefined,
    timer: ReturnType<typeof setInterval> | undefined;
  let context: ExtensionContext | undefined, command: ExtensionCommandContext | undefined;
  let stopped = false,
    restored = false;
  let settings: LifecycleSettings | undefined,
    heartbeat: Heartbeat | undefined,
    ask: Ask | undefined;
  // The last agent loop's error; a retry that recovers ends with a later agent_end that clears it.
  let lastError: string | undefined;
  // Set once the delegate package loads (last, below); a run in progress keeps the worker busy.
  const delegation: { runs?: RunTracker } = {};
  const RUN_ACTIVE = "a Claude run is still active; wait for its finished message or stop it";
  const diagnostic = (event: string) => console.error(`[assignment-worker] ${event}`);
  const wake = () => {
    if (!stopped && context?.isIdle() && !context.hasPendingMessages())
      pi.sendUserMessage("/worker-next", { expandPromptTemplates: true });
  };
  pi.registerTool({
    name: "report_execution_result",
    label: "Report execution result",
    description:
      "Submit this bound TODO's completed or blocked outcome; it is recorded immediately and the next TODO arrives as a message.",
    parameters: ExecutionResultParameters,
    async execute(_id, value) {
      if (!coordinator || stopped) throw new Error("Worker execution is not available");
      if (delegation.runs?.isRunActive()) throw new Error(RUN_ACTIVE);
      const result = await coordinator.acceptReport(value);
      return { content: [{ type: "text", text: "Report recorded." }], details: result };
    },
  });
  pi.registerTool({
    name: "ask_manager",
    label: "Ask the Manager",
    description:
      "Ask the Manager a question about the bound assignment. The answer arrives as agent mail; continue other work or wait for it.",
    parameters: AskParameters,
    async execute(_id, { objective, body, requirements }, _signal, _onUpdate, ctx) {
      const binding = currentBinding(ctx);
      if (!ask || stopped || !binding) throw new Error("No bound assignment to ask about");
      await ask.ask({
        project: binding.project,
        assignmentId: binding.assignment_id,
        objective,
        body,
        requirements,
      });
      return {
        content: [
          {
            type: "text",
            text: "Question sent to the Manager; continue other work or wait for the answer.",
          },
        ],
        details: {},
      };
    },
  });
  pi.registerCommand("worker-next", {
    description: "Reconcile worker availability without invoking a model",
    async handler(_args, ctx) {
      if (stopped || !coordinator || !ctx.isIdle() || ctx.hasPendingMessages()) return;
      // An idle worker supervising a Claude run is not available: reconciling could replace its session.
      if (delegation.runs?.isRunActive()) return;
      command = ctx;
      if (!restored) {
        const binding = currentBinding(ctx);
        restored = true;
        if (binding) {
          await coordinator.restoreBinding(binding);
          return;
        }
      }
      await coordinator.reconcile("idle");
    },
  });
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
    // Pi delivers Claude's requests only after the current tool call, so a long sleep leaves them waiting.
    if (delegation.runs?.isRunActive() && isLongSleep(event.input.command))
      return { block: true, reason: LONG_SLEEP };
    const guard = guardWorktreeCommand(event.input.command, currentBinding(ctx)?.project);
    if (!guard) return;
    if ("block" in guard) return { block: true, reason: guard.block };
    event.input.command = guard.rewrite;
  });
  pi.on("before_agent_start", (event) => {
    // Only bots that install the delegate tool may be told to use it.
    const section = delegationPromptSection(
      pi.getAllTools().map((tool) => tool.name),
      process.env,
    );
    if (section) event.systemPromptOptions.sections["delegation-models"] = section;
  });
  pi.on("session_start", async (event, ctx) => {
    if (client || stopped) return;
    const workerId = process.env.AGENT_ID?.trim();
    if (!workerId) throw new Error("AGENT_ID must identify the worker bot");
    const configured = process.env.BATTUTA_WORKER_CAPABILITIES;
    if (!configured) throw new Error("BATTUTA_WORKER_CAPABILITIES must contain configured JSON");
    let values: unknown;
    try {
      values = JSON.parse(configured);
    } catch {
      throw new Error("BATTUTA_WORKER_CAPABILITIES must contain valid JSON");
    }
    const capabilities = [...parseAbilities(values)];
    context = ctx;
    pi.setActiveTools([
      "codemode",
      "web_search",
      "web_fetch",
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "report_execution_result",
      "ask_manager",
      // Only installed tools activate: `delegate` comes from the general worker's package, not the influencer's.
      "delegate",
      "delegate_modes",
      "delegate_reply",
      "delegate_status",
      "delegate_stop",
      "send_agent_message",
      "reply_agent_message",
      "mcp__assignments__list_assignments",
      "mcp__assignments__get_assignment",
      "mcp__assignments__prepare_notes",
      "mcp__assignments__locate_notes",
    ]);
    const supabaseUrl = process.env.SUPABASE_URL ?? "",
      secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
    client = await createAssignmentClient({ supabaseUrl, secretKey });
    if (stopped) {
      await client.close();
      return;
    }
    try {
      settings = await client.settings();
    } catch (error) {
      throw new Error(
        `Lifecycle settings unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    db = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const mail = db;
    const assignments = client;
    const conversationId = ctx.sessionManager.getSessionId();
    const manager = settings.roles.manager;
    const notifier = createNotifier({
      client: mail,
      conversationId,
      senderName: workerId,
      managerName: manager,
      appendEntry: (kind, data) => pi.appendEntry(kind, data),
    });
    ask = createAsk({
      send: (message) =>
        sendProgrammaticMail(mail, {
          senderRole: workerId,
          recipientRole: manager,
          conversationId,
          ...message,
        }),
      chaseAfterMs: settings.ask.chase_after * 1000,
      chase: settings.messages.ask_chase,
      worker: workerId,
      diagnostics: diagnostic,
    });
    heartbeat = createHeartbeat({
      renew: (claim) => assignments.renew(claim),
      intervalMs: settings.heartbeat.interval * 1000,
      onLost: (reason) => void coordinator?.leaseLost(reason),
      diagnostics: diagnostic,
    });
    coordinator = createCoordinator({
      workerId,
      capabilities,
      conversationId,
      settings,
      assignments: client,
      notify: notifier,
      diagnostics: diagnostic,
      asks: ask,
      // Read on each event: the delegate runs are registered after this coordinator is created.
      runs: {
        isRunActive: () => delegation.runs?.isRunActive() ?? false,
        stop: () => delegation.runs?.stop() ?? Promise.resolve(),
      },
      sessions: {
        prepareWorkspace: (target) =>
          ensureAssignmentWorkspace(join(homedir(), ".battuta"), target),
        isIdle: () => context?.isIdle() ?? false,
        hasPendingMessages: () => context?.hasPendingMessages() ?? true,
        appendEntry: (kind, data) => pi.appendEntry(kind, data),
        abort: () => context?.abort(),
        remind(text) {
          if (stopped) return;
          pi.sendMessage(
            { customType: "assignment-reminder", content: text, display: true },
            { triggerTurn: true, deliverAs: "followUp" },
          );
        },
        async openAssignmentSession(detail: Detail) {
          if (!command) throw new Error("Session replacement requires command context");
          const binding = {
            project: detail.assignment.project,
            assignment_id: detail.assignment.id,
            claimed_at: detail.assignment.claimed_at!,
            claimed_by: detail.assignment.claimed_by,
            session_file: "",
          };
          const originalCwd = command.cwd;
          pi.appendEntry("assignment-handoff", binding);
          const result = await command.newSession({
            setup: (manager) => {
              manager.appendCustomEntry("assignment-binding", binding);
              return Promise.resolve();
            },
            withSession: async (fresh) => {
              if (fresh.cwd !== originalCwd)
                throw new Error("Worker cwd changed during replacement");
              await fresh.sendUserMessage("/worker-next", { expandPromptTemplates: true });
            },
          });
          if (result.cancelled) throw new Error("Assignment conversation replacement cancelled");
          return binding;
        },
        runTodo(_binding, todo, detail, workspace) {
          if (stopped) throw new Error("Worker session was disposed");
          pi.sendMessage(
            {
              customType: "assignment-todo",
              content: JSON.stringify({
                assignment: detail.assignment,
                todos: detail.todos,
                current_todo: todo,
                workspace,
              }),
              display: true,
            },
            { triggerTurn: true, deliverAs: "followUp" },
          );
        },
      },
    });
    coordinator.on("bound", (binding) => heartbeat?.start(binding));
    coordinator.on("unbound", () => {
      heartbeat?.stop();
      ask?.cancel();
    });
    db.channel(`assignment-availability-${ctx.sessionManager.getSessionId()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "assignment_availability" },
        wake,
      )
      .subscribe((state: string) => {
        if (state === "SUBSCRIBED") wake();
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
          diagnostic("Availability stream unavailable; fallback reconciliation remains active");
      });
    timer = setInterval(wake, 30000);
    // A live replacement restores through its command before reconciling another assignment.
    if (event.reason !== "new") wake();
  });
  pi.on("message_start", (event) => {
    const message = event.message;
    if (message.role !== "custom" || message.customType !== "agent-mail" || !settings) return;
    if (typeof message.content !== "string") return;
    try {
      const mail = JSON.parse(message.content) as { sender?: unknown };
      if (mail.sender === settings.roles.manager) ask?.answered();
    } catch {
      // Malformed mail is the agent-mail extension's concern; it never ends a wait.
    }
  });
  pi.on("agent_end", (event) => {
    const last = [...event.messages].reverse().find((message) => message.role === "assistant");
    const stop = last && "stopReason" in last ? last.stopReason : undefined;
    lastError =
      stop === "error"
        ? describeFailure("errorMessage" in last! ? last.errorMessage : undefined)
        : stop === "aborted"
          ? ABORTED
          : undefined;
  });
  pi.on("agent_settled", async (event, ctx) => {
    context = ctx;
    const failure = event.aborted ? ABORTED : lastError;
    lastError = undefined;
    if (failure) await coordinator?.agentFailed(failure);
    else await coordinator?.agentIdle();
    wake();
  });
  const shutdown = () => {
    heartbeat?.stop();
    ask?.cancel();
    const binding = context ? currentBinding(context) : undefined;
    if (binding) pi.appendEntry("assignment-shutdown", { assignment_id: binding.assignment_id });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  pi.on("session_shutdown", async () => {
    if (stopped) return;
    stopped = true;
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    try {
      shutdown();
    } catch (error) {
      diagnostic(`Shutdown entry failed: ${String(error)}`);
    }
    if (timer) clearInterval(timer);
    await coordinator?.stop();
    await db?.removeAllChannels();
    await client?.close();
  });
  // Last: everything above registers synchronously, and loading the delegate package awaits.
  delegation.runs = await registerProjectDelegate(pi, {
    // Pi runs in the bot profile and installs its project packages under <cwd>/.pi/npm; this file's own path is
    // no guide, since a source profile links it from the checkout.
    profileDir: join(process.cwd(), ".pi"),
    projectsRoot: join(homedir(), ".battuta", "projects"),
    log: diagnostic,
  });
}
