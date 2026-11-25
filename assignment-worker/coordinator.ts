import { isDeepStrictEqual } from "node:util";
import {
  AssignmentRefusalError,
  UncertainAssignmentWriteError,
  blockAndInspect,
} from "./client.ts";
import { fill, messageText, parseAbilities, parseExecutionResult } from "./contracts.ts";
import type {
  Coordinator,
  CoordinatorOptions,
  Binding,
  Detail,
  ExecutionResult,
  TodoRow,
  AssignmentView,
  Workspace,
} from "./types.ts";

type Phase = "idle" | "claiming" | "switching" | "executing" | "persisting" | "reporting";

/**
 * The worker's only writer of assignment and TODO state. It reacts to events (a report, an agent error, an
 * idle agent, a lost lease) and never infers an outcome from a turn ending. When a write cannot be
 * confirmed it blocks with an explanation; when even that fails it releases the claim and lets the lease
 * lapse, so the database blocks the assignment and tells the Manager.
 */
export function createCoordinator(options: CoordinatorOptions): Coordinator {
  const { assignments, sessions, notify, diagnostics, runs, asks, settings } = options;
  let phase: Phase = "idle",
    stopped = false;
  let binding: Binding | undefined, current: TodoRow | undefined, workspace: Workspace | undefined;
  let reminded = false;
  let tail: Promise<unknown> = Promise.resolve();
  let reconciling: Promise<void> | undefined;
  const abilities: ReadonlySet<string> = parseAbilities(options.capabilities);
  const listeners = {
    bound: [] as ((b: Binding) => void)[],
    unbound: [] as ((b: Binding) => void)[],
  };
  const emit = (event: keyof typeof listeners, value: Binding) => {
    for (const listener of listeners[event]) listener({ ...value });
  };
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  }
  function unbind() {
    const previous = binding;
    binding = undefined;
    workspace = undefined;
    current = undefined;
    reminded = false;
    asks?.cancel();
    phase = "idle";
    if (previous) emit("unbound", previous);
    queueMicrotask(() => {
      void coordinator.reconcile("idle");
    });
  }
  /** Drops the claim locally: stop the run and the agent, stop renewing, return to idle. */
  async function release(event: string, error?: unknown) {
    if (stopped) return;
    diagnostics(event, error);
    if (!binding) {
      phase = "idle";
      return;
    }
    sessions.appendEntry("assignment-released", {
      assignment_id: binding.assignment_id,
      claimed_at: binding.claimed_at,
      reason: event,
    });
    if (runs?.isRunActive())
      await runs.stop().catch((e: unknown) => diagnostics("Run stop failed", e));
    sessions.abort();
    unbind();
  }
  const matches = (row: AssignmentView) =>
    binding !== undefined &&
    row.id === binding.assignment_id &&
    row.project === binding.project &&
    row.claimed_at === binding.claimed_at &&
    row.claimed_by === binding.claimed_by;
  async function deliver(detail: Detail) {
    if (stopped) return;
    if (!matches(detail.assignment) || !["done", "blocked"].includes(detail.assignment.status)) {
      await release("Persisted outcome no longer belongs to this execution");
      return;
    }
    phase = "reporting";
    try {
      const delivery = await notify(detail);
      if (stopped) return;
      if (delivery.state !== "sent")
        diagnostics(`Manager notification ${delivery.state}: ${delivery.explanation}`);
    } catch (error) {
      diagnostics("Manager notification failed after persistence; do not replay execution", error);
    }
    if (!stopped) unbind();
  }
  async function blockRun(explanation: string) {
    if (stopped || !binding) return;
    phase = "persisting";
    try {
      const detail = await blockAndInspect(assignments, binding, explanation);
      if (!stopped) await deliver(detail);
    } catch (error) {
      await release("Could not confirm the execution blocker; the lease will lapse", error);
    }
  }
  async function finish() {
    if (stopped || !binding) return;
    phase = "persisting";
    try {
      await assignments.finish(binding);
    } catch (error) {
      if (!(error instanceof UncertainAssignmentWriteError)) {
        await release("Assignment completion refused", error);
        return;
      }
    }
    if (stopped) return;
    const detail = await assignments.get(binding);
    if (stopped) return;
    if (!matches(detail.assignment) || detail.assignment.status !== "done") {
      await release("Assignment completion remains unconfirmed; inspect before repeating");
      return;
    }
    await deliver(detail);
  }
  async function prepareWorkspace() {
    if (stopped || !binding) return;
    if (workspace) return workspace;
    try {
      workspace = await sessions.prepareWorkspace(binding);
      return stopped ? undefined : workspace;
    } catch (error) {
      diagnostics("Local assignment workspace preparation failed", error);
      await blockRun(
        "Local assignment workspace could not be prepared safely; no work was dispatched",
      );
    }
  }
  async function advance(detail?: Detail) {
    if (stopped || !binding) return;
    const latest = detail ?? (await assignments.get(binding));
    if (stopped) return;
    if (!matches(latest.assignment) || latest.assignment.status !== "in_process") {
      await release("Execution claim was superseded; progression stopped");
      return;
    }
    if (!latest.assignment.require_abilities.every((ability) => abilities.has(ability))) {
      await blockRun("This session lacks required specialist abilities; no TODO was dispatched");
      return;
    }
    const ready = await prepareWorkspace();
    if (!ready) return;
    const next = latest.todos.find((todo) => !["done", "cancelled"].includes(todo.status));
    if (!next) {
      if (!latest.todos.length) {
        await blockRun("The assignment has no executable initial plan");
        return;
      }
      await finish();
      return;
    }
    phase = "persisting";
    let started;
    try {
      started = await assignments.start({
        ...binding,
        position: next.position,
        expected_updated_at: next.updated_at,
      });
    } catch (error) {
      if (error instanceof AssignmentRefusalError) {
        await release("TODO start refused; inspect current execution", error);
        return;
      }
      await blockRun("TODO start could not be confirmed before invoking the model");
      return;
    }
    if (stopped) return;
    current = started.todo;
    reminded = false;
    phase = "executing";
    sessions.runTodo({ ...binding }, structuredClone(current), latest, ready);
  }
  function matchesReport(todo: TodoRow, row: AssignmentView, report: ExecutionResult) {
    return (
      matches(row) &&
      todo.status === (report.outcome === "completed" ? "done" : "blocked") &&
      todo.outcome === report.summary &&
      isDeepStrictEqual(todo.evidence, report.evidence) &&
      todo.blocker === (report.outcome === "blocked" ? report.blocker : null) &&
      (report.outcome === "completed"
        ? row.status === "in_process"
        : row.status === "blocked" && row.blocker === report.blocker)
    );
  }
  async function record(report: ExecutionResult) {
    if (!binding || !current) return;
    const position = current.position;
    phase = "persisting";
    let stored;
    try {
      stored = await assignments.record({
        ...binding,
        position,
        expected_updated_at: current.updated_at,
        ...report,
      });
    } catch (error) {
      if (!(error instanceof UncertainAssignmentWriteError)) {
        await release("Execution result refused; stop obsolete progression", error);
        return;
      }
      const inspected = await assignments.get(binding);
      const todo = inspected.todos.find((todo) => todo.position === position);
      if (!todo || !matchesReport(todo, inspected.assignment, report)) {
        await release("Execution result remains unconfirmed; do not replay work");
        return;
      }
      stored = { assignment: inspected.assignment, todo };
    }
    if (stopped) return;
    if (!matchesReport(stored.todo, stored.assignment, report)) {
      await release("Stored result did not match the submitted report");
      return;
    }
    if (report.outcome === "blocked") await deliver(await assignments.get(binding));
    else await advance();
  }
  const coordinator: Coordinator = {
    reconcile() {
      if (reconciling) return reconciling;
      reconciling = serial(async () => {
        if (stopped || phase !== "idle" || !sessions.isIdle() || sessions.hasPendingMessages())
          return;
        phase = "claiming";
        try {
          const board = await assignments.list({ status: "active" });
          if (stopped) return;
          for (const candidate of board.assignments
            .filter(
              (row) =>
                row.ready && row.require_abilities.every((ability) => abilities.has(ability)),
            )
            .reverse()) {
            let detail: Detail;
            try {
              detail = await assignments.claim({
                project: candidate.project,
                assignment_id: candidate.id,
                claimed_by: options.workerId,
                abilities: [...abilities],
                conversation_id: options.conversationId,
              });
            } catch (error) {
              if (stopped) return;
              if (
                error instanceof AssignmentRefusalError &&
                ["not_claimable", "not_found", "ability_mismatch"].includes(error.refusal.code)
              )
                continue;
              // An unconfirmed claim nobody renews lapses, and the cron blocks it and tells the Manager.
              await release("Claim could not be confirmed; do not infer ownership", error);
              return;
            }
            if (stopped) return;
            if (
              !detail.assignment.claimed_at ||
              detail.assignment.claimed_by !== options.workerId
            ) {
              await release("Claim response omitted its version; inspect ownership");
              return;
            }
            binding = {
              project: detail.assignment.project,
              assignment_id: detail.assignment.id,
              claimed_at: detail.assignment.claimed_at,
              claimed_by: detail.assignment.claimed_by,
              session_file: "",
            };
            phase = "switching";
            emit("bound", binding);
            if (!(await prepareWorkspace())) return;
            let live: Detail;
            try {
              live = await assignments.get(binding);
            } catch (error) {
              await release("Claim could not be verified after workspace preparation", error);
              return;
            }
            if (!matches(live.assignment) || live.assignment.status !== "in_process") {
              await release("Execution claim was superseded; progression stopped");
              return;
            }
            try {
              const opened = await sessions.openAssignmentSession(detail);
              if (!stopped) binding = opened;
            } catch (error) {
              if (stopped) return;
              diagnostics("Fresh assignment conversation failed", error);
              await blockRun("Assignment conversation did not initialize; no work was dispatched");
            }
            return;
          }
          phase = "idle";
        } catch (error) {
          if (stopped) return;
          phase = "idle";
          diagnostics("Work board could not be read", error);
        }
      }).finally(() => {
        reconciling = undefined;
      });
      return reconciling;
    },
    restoreBinding(next) {
      return serial(async () => {
        if (stopped) return;
        if (
          binding &&
          (binding.claimed_at !== next.claimed_at ||
            binding.claimed_by !== next.claimed_by ||
            binding.assignment_id !== next.assignment_id ||
            binding.project !== next.project)
        )
          throw new Error("Cannot replace a live assignment binding");
        if (binding && phase !== "switching" && phase !== "idle") return;
        binding = { ...next };
        phase = "switching";
        emit("bound", binding);
        try {
          await advance();
        } catch (error) {
          diagnostics("Assignment context failed", error);
          await blockRun("Assignment context could not be loaded");
        }
      });
    },
    acceptReport(value) {
      return serial(async () => {
        const report = structuredClone(parseExecutionResult(value));
        if (stopped || phase !== "executing" || !current || !binding)
          throw new Error("No bound executing TODO accepts this report");
        sessions.appendEntry("assignment-report", {
          assignment_id: binding.assignment_id,
          position: current.position,
          report,
        });
        try {
          await record(report);
        } catch (error) {
          await release("Execution result could not be inspected or advanced", error);
        }
        return { accepted: true as const };
      });
    },
    agentFailed(blocker) {
      return serial(async () => {
        if (stopped || phase !== "executing" || !binding) return;
        if (runs?.isRunActive())
          await runs.stop().catch((error: unknown) => diagnostics("Run stop failed", error));
        await blockRun(blocker);
      });
    },
    agentIdle() {
      return serial(async () => {
        if (stopped || phase !== "executing" || !binding || !current) return;
        if (runs?.isRunActive() || sessions.hasPendingMessages() || asks?.waiting) return;
        const values = { position: String(current.position), assignment_id: binding.assignment_id };
        if (!reminded) {
          reminded = true;
          sessions.remind(messageText(fill(settings.messages.idle_reminder, values)));
          return;
        }
        await blockRun(messageText(fill(settings.messages.no_report_blocker, values)));
      });
    },
    leaseLost(reason) {
      return serial(() => release(reason));
    },
    stop() {
      stopped = true;
      return Promise.resolve();
    },
    on(event, listener) {
      listeners[event].push(listener);
    },
  };
  return coordinator;
}
