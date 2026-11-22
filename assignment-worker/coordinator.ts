import { isDeepStrictEqual } from "node:util";
import {
  AssignmentRefusalError,
  UncertainAssignmentWriteError,
  blockAndInspect,
} from "./client.ts";
import { describeFailure } from "./errors.ts";
import { parseAbilities, parseExecutionResult } from "./contracts.ts";
import type {
  Coordinator,
  CoordinatorOptions,
  Binding,
  Detail,
  ExecutionResult,
  RunOutcome,
  TodoRow,
  AssignmentView,
  Workspace,
} from "./types.ts";

/** The blocker for a result turn that reports nothing after its run failed, timed out or was stopped. */
function failedRunBlocker(outcome: RunOutcome | undefined): string | undefined {
  if (!outcome || outcome.state === "finished") return undefined;
  const run = `Delegate run ${outcome.sessionId ?? "(session id not reported)"}`;
  const timeout = /timed out after (\d+)ms/.exec(outcome.reason ?? "");
  const how =
    outcome.state === "stopped"
      ? "was stopped"
      : timeout
        ? `timed out after ${Number(timeout[1]) / 1000}s`
        : `failed: ${outcome.reason ?? "unknown error"}`;
  return `${run} ${how}; no report_execution_result was accepted`;
}

type Phase =
  "idle" | "claiming" | "switching" | "executing" | "persisting" | "reporting" | "paused";

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  const { assignments, sessions, notify, diagnostics, runs } = options;
  let phase: Phase = "idle",
    stopped = false;
  let binding: Binding | undefined,
    current: TodoRow | undefined,
    accepted: ExecutionResult | undefined;
  let boundary: "completed" | "aborted" | "error" | undefined;
  let boundaryError: string | undefined;
  // The last run outcome at the turn's boundary; a newer one at settle has a result turn still to come.
  let boundaryRunOutcome: RunOutcome | undefined;
  // The last run outcome when the current TODO started; only a newer one is named in this TODO's blocker.
  let seenRunOutcome: RunOutcome | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let reconciling: Promise<void> | undefined;
  const abilities: ReadonlySet<string> = parseAbilities(options.capabilities);
  let workspace: Workspace | undefined;
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
    row.claimed_at === binding.claimed_at &&
    row.claimed_by === binding.claimed_by;
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
    workspace = undefined;
    current = undefined;
    accepted = undefined;
    boundary = undefined;
    boundaryError = undefined;
    boundaryRunOutcome = undefined;
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
    if (stopped || !checkLive(latest)) return;
    if (!latest.assignment.require_abilities.every((ability) => abilities.has(ability))) {
      await blockRun("This session lacks required specialist abilities; no TODO was dispatched");
      return;
    }
    const workspace = await prepareWorkspace();
    if (!workspace) return;
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
    boundaryError = undefined;
    boundaryRunOutcome = undefined;
    seenRunOutcome = runs?.lastRunOutcome?.();
    phase = "executing";
    sessions.runTodo({ ...binding }, structuredClone(current), latest, workspace);
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
              });
            } catch (error) {
              if (stopped) return;
              if (
                error instanceof AssignmentRefusalError &&
                ["not_claimable", "not_found", "ability_mismatch"].includes(error.refusal.code)
              )
                continue;
              pause("Claim could not be confirmed; do not infer ownership or retry", error);
              return;
            }
            if (stopped) return;
            if (
              !detail.assignment.claimed_at ||
              detail.assignment.claimed_by !== options.workerId
            ) {
              pause("Claim response omitted its version; inspect ownership");
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
            if (!(await prepareWorkspace())) return;
            try {
              if (!checkLive(await assignments.get(binding))) return;
            } catch (error) {
              pause(
                "Claim could not be verified after workspace preparation; retained for inspection",
                error,
              );
              return;
            }
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
            binding.claimed_by !== next.claimed_by ||
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
    observeBoundary(outcome, errorMessage) {
      if (stopped || phase !== "executing") return;
      boundary = outcome;
      boundaryRunOutcome = runs?.lastRunOutcome?.();
      boundaryError = errorMessage;
    },
    settle(event) {
      return serial(async () => {
        if (stopped || phase !== "executing" || !binding || !current) return;
        if (event.aborted || boundary === "aborted" || boundary === "error") {
          await blockRun(
            event.aborted || boundary === "aborted"
              ? "Execution was aborted before confirmed completion"
              : describeFailure(boundaryError),
          );
          return;
        }
        if (boundary !== "completed") {
          pause("Execution settled without a final boundary outcome");
          return;
        }
        if (!accepted) {
          // A run in progress, or one that ended after this turn's boundary, keeps the TODO bound: its
          // result arrives as a new turn. A run that ended before the boundary has no turn to come (its
          // result was returned or steered into this one), so deferring for it would never settle.
          const ended = runs?.lastRunOutcome?.();
          if (runs?.isRunActive() || ended !== boundaryRunOutcome) {
            diagnostics(
              "Turn ended with a delegate run active or its result queued; TODO stays bound",
            );
            return;
          }
          await blockRun(
            failedRunBlocker(ended !== seenRunOutcome ? ended : undefined) ??
              "Execution settled without a valid report_execution_result",
          );
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
