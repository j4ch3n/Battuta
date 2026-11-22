import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createClient } from "@supabase/supabase-js";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssignmentClient } from "./client.ts";
import { delegationPromptSection } from "./delegation.ts";
import { createCoordinator } from "./coordinator.ts";
import { ExecutionResultParameters, currentBinding, parseAbilities } from "./contracts.ts";
import { guardWorktreeCommand } from "./worktree-guard.ts";
import { registerProjectDelegate } from "./project-delegate.ts";
import { createNotifier } from "./notify.ts";
import { ensureAssignmentWorkspace } from "./workspace.ts";
import type { AssignmentClient, Coordinator, Detail, RunTracker } from "./types.ts";

export default async function worker(pi: ExtensionAPI) {
  let coordinator: Coordinator | undefined, client: AssignmentClient | undefined;
  let db: ReturnType<typeof createClient> | undefined,
    timer: ReturnType<typeof setInterval> | undefined;
  let context: ExtensionContext | undefined, command: ExtensionCommandContext | undefined;
  let stopped = false,
    restored = false;
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
      "Submit this bound TODO's completed or blocked outcome; awaits final turn settlement and persistence.",
    parameters: ExecutionResultParameters,
    async execute(_id, value) {
      if (!coordinator || stopped) throw new Error("Worker execution is not available");
      if (delegation.runs?.isRunActive()) throw new Error(RUN_ACTIVE);
      const result = await coordinator.acceptReport(value);
      return {
        content: [{ type: "text", text: "Report accepted; awaiting final turn settlement." }],
        details: result,
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
    db = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const notifier = createNotifier({
      client: db,
      conversationId: ctx.sessionManager.getSessionId(),
      senderName: workerId,
      managerName: "manager",
      appendEntry: (kind, data) => pi.appendEntry(kind, data),
    });
    coordinator = createCoordinator({
      workerId,
      capabilities,
      assignments: client,
      notify: notifier,
      diagnostics: diagnostic,
      // Read at each settle: the delegate runs are registered after this coordinator is created.
      runs: {
        isRunActive: () => delegation.runs?.isRunActive() ?? false,
        lastRunOutcome: () => delegation.runs?.lastRunOutcome?.(),
      },
      sessions: {
        prepareWorkspace: (target) =>
          ensureAssignmentWorkspace(join(homedir(), ".battuta"), target),
        isIdle: () => context?.isIdle() ?? false,
        hasPendingMessages: () => context?.hasPendingMessages() ?? true,
        appendEntry: (kind, data) => pi.appendEntry(kind, data),
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
            { triggerTurn: true },
          );
        },
      },
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
  pi.on("agent_before_settle", (event) => {
    const last = [...event.context.contextMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    coordinator?.observeBoundary(
      event.outcome,
      last && "errorMessage" in last ? last.errorMessage : undefined,
    );
  });
  pi.on("agent_settled", async (event, ctx) => {
    context = ctx;
    await coordinator?.settle(event);
    wake();
  });
  pi.on("session_shutdown", async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    await coordinator?.stop();
    await db?.removeAllChannels();
    await client?.close();
  });
  // Last: everything above registers synchronously, and loading the delegate package awaits.
  delegation.runs = await registerProjectDelegate(pi, {
    // dist/index.js sits in <profile>/.pi/extensions/assignment-worker/dist, so the profile's .pi directory is three levels up.
    profileDir: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
    projectsRoot: join(homedir(), ".battuta", "projects"),
    log: diagnostic,
  });
}
