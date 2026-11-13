import { isDeepStrictEqual } from "node:util";
import {
  AssignmentRefusalError,
  UncertainAssignmentWriteError,
  blockAndInspect,
} from "./client.ts";
import { parseExecutionResult } from "./contracts.ts";
import type {
  Coordinator,
  CoordinatorOptions,
  Binding,
  Detail,
  ExecutionResult,
  TodoRow,
  AssignmentView,
} from "./types.ts";

type Phase =
  "idle" | "claiming" | "switching" | "executing" | "persisting" | "reporting" | "paused";

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  const { assignments, sessions, notify, diagnostics } = options;
  let phase: Phase = "idle",
    stopped = false;
  let binding: Binding | undefined,
    current: TodoRow | undefined,
    accepted: ExecutionResult | undefined;
  let boundary: "completed" | "aborted" | "error" | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let reconciling: Promise<void> | undefined;
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  }
  function pause(event: string, error?: unknown) {
    if (stopped) return;
    phase = "paused";
    diagnostics(event, error);
  }
  const matches = (row: AssignmentView) =>
    binding !== undefined &&
    row.id === binding.assignment_id &&
    row.project === binding.project &&
    row.claimed_at === binding.claimed_at;
  function checkLive(detail: Detail) {
    if (!matches(detail.assignment) || detail.assignment.status !== "in_process") {
      pause("Execution claim was superseded; progression stopped");
      return false;
    }
    return true;
  }
  async function deliver(detail: Detail) {
    if (stopped) return;
    if (!matches(detail.assignment) || !["done", "blocked"].includes(detail.assignment.status)) {
      pause("Persisted outcome no longer belongs to this execution");
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
    if (stopped) return;
    binding = undefined;
    current = undefined;
    accepted = undefined;
    boundary = undefined;
    phase = "idle";
    queueMicrotask(() => {
      void coordinator.reconcile("idle");
    });
  }
  async function blockRun(explanation: string) {
    if (stopped || !binding) return;
    phase = "persisting";
    try {
      const detail = await blockAndInspect(assignments, binding, explanation);
      if (!stopped) await deliver(detail);
    } catch (error) {
      pause("Could not confirm the execution blocker; keep the claim for inspection", error);
    }
  }
  async function finish() {
    if (stopped || !binding) return;
    phase = "persisting";
    try {
      await assignments.finish(binding);
    } catch (error) {
      if (!(error instanceof UncertainAssignmentWriteError)) {
        pause("Assignment completion refused", error);
        return;
      }
    }
    if (stopped) return;
    const detail = await assignments.get(binding);
    if (stopped) return;
    if (!matches(detail.assignment) || detail.assignment.status !== "done") {
      pause("Assignment completion remains unconfirmed; inspect before repeating");
      return;
    }
    await deliver(detail);
  }
  async function advance(detail?: Detail) {
    if (stopped || !binding) return;
    const latest = detail ?? (await assignments.get(binding));
    if (stopped || !checkLive(latest)) return;
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
        pause("TODO start refused; inspect current execution", error);
        return;
      }
      await blockRun("TODO start could not be confirmed before invoking the model");
      return;
    }
    if (stopped) return;
    current = started.todo;
    accepted = undefined;
    boundary = undefined;
    phase = "executing";
    sessions.runTodo({ ...binding }, structuredClone(current), latest);
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
          for (const candidate of board.assignments.filter((row) => row.ready).reverse()) {
            let detail: Detail;
            try {
              detail = await assignments.claim({
                project: candidate.project,
                assignment_id: candidate.id,
              });
            } catch (error) {
              if (stopped) return;
              if (
                error instanceof AssignmentRefusalError &&
                ["not_claimable", "not_found"].includes(error.refusal.code)
              )
                continue;
              pause("Claim could not be confirmed; do not infer ownership or retry", error);
              return;
            }
            if (stopped) return;
            if (!detail.assignment.claimed_at) {
              pause("Claim response omitted its version; inspect ownership");
              return;
            }
            binding = {
              project: detail.assignment.project,
              assignment_id: detail.assignment.id,
              claimed_at: detail.assignment.claimed_at,
              session_file: "",
            };
            phase = "switching";
            try {
              const opened = await sessions.openAssignmentSession(detail);
              if (!stopped) binding = opened;
            } catch (error) {
              if (stopped) return;
              diagnostics("Fresh assignment conversation failed", error);
              pause(
                "Assignment conversation did not initialize; inspect the retained claim",
                error,
              );
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
            binding.assignment_id !== next.assignment_id ||
            binding.project !== next.project)
        )
          throw new Error("Cannot replace a live assignment binding");
        if (binding && phase !== "switching" && phase !== "idle") return;
        binding = { ...next };
        phase = "switching";
        try {
          await advance();
        } catch (error) {
          await blockRun("Assignment context could not be loaded");
          diagnostics("Assignment context failed", error);
        }
      });
    },
    acceptReport(value) {
      return serial(() => {
        if (stopped || phase !== "executing" || !current || !binding)
          throw new Error("No bound executing TODO accepts this report");
        const report = structuredClone(parseExecutionResult(value));
        if (accepted && !isDeepStrictEqual(accepted, report))
          throw new Error("A different report was already accepted for this TODO");
        if (!accepted) {
          sessions.appendEntry("assignment-report", {
            assignment_id: binding.assignment_id,
            position: current.position,
            report,
          });
          accepted = report;
        }
        return Promise.resolve({ accepted: true as const });
      });
    },
    observeBoundary(outcome) {
      if (!stopped && phase === "executing") boundary = outcome;
    },
    settle(event) {
      return serial(async () => {
        if (stopped || phase !== "executing" || !binding || !current) return;
        if (event.aborted || boundary === "aborted" || boundary === "error") {
          await blockRun(
            event.aborted || boundary === "aborted"
              ? "Execution was aborted before confirmed completion"
              : "Execution ended with an unrecoverable error",
          );
          return;
        }
        if (boundary !== "completed") {
          pause("Execution settled without a final boundary outcome");
          return;
        }
        if (!accepted) {
          await blockRun("Execution settled without a valid report_execution_result");
          return;
        }
        const report = accepted,
          position = current.position;
        phase = "persisting";
        try {
          let recorded;
          try {
            recorded = await assignments.record({
              ...binding,
              position,
              expected_updated_at: current.updated_at,
              ...report,
            });
          } catch (error) {
            if (!(error instanceof UncertainAssignmentWriteError)) {
              pause("Execution result refused; stop obsolete progression", error);
              return;
            }
            const inspected = await assignments.get(binding);
            const todo = inspected.todos.find((todo) => todo.position === position);
            if (!todo || !matchesReport(todo, inspected.assignment, report)) {
              pause("Execution result remains unconfirmed; do not replay work");
              return;
            }
            recorded = { assignment: inspected.assignment, todo };
          }
          if (stopped) return;
          if (!matchesReport(recorded.todo, recorded.assignment, report)) {
            pause("Stored result did not match the submitted report");
            return;
          }
          if (report.outcome === "blocked") await deliver(await assignments.get(binding));
          else await advance();
        } catch (error) {
          pause("Execution result could not be inspected or advanced", error);
        }
      });
    },
    stop() {
      stopped = true;
      return Promise.resolve();
    },
  };
  return coordinator;
}
