import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAssignmentClient } from "./client.ts";
import { createCoordinator } from "./coordinator.ts";
import { AbilityRegistrationSchema, ExecutionResultSchema, parseBinding } from "./contracts.ts";
import { createNotifier } from "./notify.ts";
import { ensureAssignmentWorkspace } from "./workspace.ts";
import type { AssignmentClient, Coordinator, Detail } from "./types.ts";

export default function worker(pi: ExtensionAPI) {
  let coordinator: Coordinator | undefined, client: AssignmentClient | undefined;
  let db: ReturnType<typeof createClient> | undefined,
    timer: ReturnType<typeof setInterval> | undefined;
  let context: ExtensionContext | undefined, command: ExtensionCommandContext | undefined;
  let stopped = false,
    restored = false,
    registrationPrompted = false;
  const workerId = randomUUID();
  const diagnostic = (event: string) => console.error(`[assignment-worker] ${event}`);
  const wake = () => {
    if (!stopped && context?.isIdle() && !context.hasPendingMessages())
      pi.sendUserMessage("/worker-next", { expandPromptTemplates: true });
  };
  pi.registerTool({
    name: "register_worker_abilities",
    label: "Register worker abilities",
    description:
      "Declare this session's specialist abilities before claiming or executing work. The catalog is currently empty: use []. General skills are not specialist tags.",
    parameters: AbilityRegistrationSchema,
    execute(_id, value) {
      return Promise.resolve().then(() => {
        if (!coordinator || stopped) throw new Error("Worker execution is not available");
        coordinator.registerAbilities(value.abilities);
        return {
          content: [
            {
              type: "text",
              text: "Session abilities registered. Availability will be checked after this turn settles.",
            },
          ],
          details: { registered: true },
        };
      });
    },
  });
  pi.registerTool({
    name: "report_execution_result",
    label: "Report execution result",
    description:
      "Submit this bound TODO's completed or blocked outcome; awaits final turn settlement and persistence.",
    parameters: ExecutionResultSchema,
    async execute(_id, value) {
      if (!coordinator || stopped) throw new Error("Worker execution is not available");
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
      command = ctx;
      if (!coordinator.abilitiesReady) {
        if (!registrationPrompted) {
          registrationPrompted = true;
          pi.sendMessage(
            {
              customType: "worker-ability-registration",
              content:
                "Before taking or resuming any assignment, call register_worker_abilities with your specialist ability set. The catalog is currently empty; register [] for general work. Do not execute assignment work during this registration turn.",
              display: true,
            },
            { triggerTurn: true },
          );
        }
        return;
      }
      if (!restored) {
        const entry = [...ctx.sessionManager.getEntries()]
          .reverse()
          .find((entry) => entry.type === "custom" && entry.customType === "assignment-binding");
        if (entry?.type === "custom") {
          const binding = parseBinding(entry.data, ctx.sessionManager.getSessionFile() ?? "");
          restored = true;
          await coordinator.restoreBinding(binding);
          return;
        }
        restored = true;
      }
      await coordinator.reconcile("idle");
    },
  });
  pi.on("session_start", async (event, ctx) => {
    if (client || stopped) return;
    context = ctx;
    pi.setActiveTools([
      "codemode",
      "Agent",
      "get_subagent_result",
      "steer_subagent",
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
      "register_worker_abilities",
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
      appendEntry: (kind, data) => pi.appendEntry(kind, data),
    });
    coordinator = createCoordinator({
      workerId,
      assignments: client,
      notify: notifier,
      diagnostics: diagnostic,
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
            claim_by: detail.assignment.claim_by,
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
    coordinator?.observeBoundary(event.outcome);
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
}
