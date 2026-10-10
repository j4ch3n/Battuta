import type { TaskClient } from "../task-delegation/client.ts";
import type { Principal } from "../supabase/functions/_shared/task-contracts.ts";
import { validateReport } from "../supabase/functions/_shared/task-contracts.ts";
import type { TaskRow, TerminalReport } from "../supabase/functions/_shared/task-contracts.ts";
import type { WorkerConfig } from "./config.ts";
import type { OpenCodeAdapter, ExecutionSnapshot } from "./opencode.ts";
import type { prepareWorktree } from "./worktree.ts";
import { isDeepStrictEqual } from "node:util";

export interface DaemonOptions {
  config: WorkerConfig;
  tasks: {
    principal: Principal;
    client: Pick<TaskClient, "claim" | "listOwned" | "bind" | "finalize">;
  };
  opencode: OpenCodeAdapter;
  prepareWorktree: typeof prepareWorktree;
  subscribeQueue: (
    projects: string[],
    wake: () => void,
    signal: AbortSignal,
  ) => Promise<() => void | Promise<void>>;
  log: (kind: string, detail: string) => void;
  clock?: {
    now(): number;
    setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  };
}
export function verifyAuthority(config: WorkerConfig, principal: Principal): void {
  if (
    principal.role !== "worker" ||
    principal.worker_id !== config.workerId ||
    Object.keys(config.projects).some((project) => !principal.projects.includes(project))
  )
    throw new Error(
      "Worker authority does not match configured identity and every project mapping",
    );
}
function battuta(session: { metadata: unknown }): Record<string, unknown> | undefined {
  const metadata = session.metadata;
  if (!metadata || typeof metadata !== "object" || !("battuta" in metadata)) return;
  const value = metadata.battuta;
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}
export async function runDaemon(options: DaemonOptions, signal: AbortSignal): Promise<void> {
  const { config, tasks, opencode, log } = options;
  verifyAuthority(config, tasks.principal);
  const clock = options.clock ?? { now: Date.now, setTimeout, clearTimeout };
  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const projects = Object.keys(config.projects);
  let pending = true;
  let notify: (() => void) | undefined;
  const wake = () => {
    if (!local.signal.aborted) {
      pending = true;
      notify?.();
    }
  };
  const wait = (ms: number, wakeable: boolean): Promise<void> =>
    new Promise((resolve) => {
      if (local.signal.aborted) return resolve();
      const finish = () => {
        clock.clearTimeout(timer);
        local.signal.removeEventListener("abort", finish);
        if (notify === finish) notify = undefined;
        resolve();
      };
      const timer = clock.setTimeout(finish, ms);
      local.signal.addEventListener("abort", finish, { once: true });
      if (wakeable) notify = finish;
    });
  // Only identical pending finalization payloads are retained in memory. No local ledger,
  // attempt state or execution retry: authoritative ownership is fetched each pass.
  const finalizations = new Map<string, TerminalReport>();
  let uncertainClaim = false;
  let failures = 0;
  let retryAt = 0;
  let unsubscribe: (() => void | Promise<void>) | undefined;
  let eventPump: Promise<void> | undefined;
  const recovery = (taskId: string, reason: string) =>
    log(
      "recovery_required",
      `${taskId}: ${reason}; inspect retained execution manually (FIS-51); no automatic repair`,
    );
  const ownedTasks = async () => {
    const rows: TaskRow[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await tasks.client.listOwned(cursor, local.signal);
      for (const row of page.tasks) {
        if (
          row.claimed_by !== config.workerId ||
          row.terminal_report !== null ||
          !projects.includes(row.project) ||
          ids.has(row.id)
        )
          throw new Error("Unsupported owned task response");
        ids.add(row.id);
        rows.push(row);
      }
      if (page.next !== null && cursors.has(page.next))
        throw new Error("Repeated owned task cursor");
      if (page.next !== null) cursors.add(page.next);
      cursor = page.next ?? undefined;
    } while (cursor !== undefined && !local.signal.aborted);
    return rows;
  };
  const finalize = async (row: TaskRow, report: TerminalReport) => {
    const original =
      finalizations.get(row.id) ?? structuredClone(validateReport(report, row.instruction));
    finalizations.set(row.id, original);
    await tasks.client.finalize(row.id, original, local.signal);
    finalizations.delete(row.id);
  };
  const reconcile = async () => {
    const owned = await ownedTasks();
    if (local.signal.aborted) return;
    // Only a successful complete scan can establish that a lost-ack finalization
    // is no longer unfinished. Failed/aborted pages never authorize cache eviction.
    const ownedIds = new Set(owned.map((row) => row.id));
    for (const id of finalizations.keys()) {
      if (!ownedIds.has(id) && finalizations.delete(id))
        log(
          "finalization_reconciled",
          `${id}: no longer unfinished after full ownership scan; discarded pending report`,
        );
    }
    const sessions = await opencode.listSessions(local.signal);
    let blocked = uncertainClaim;
    let unfinished = owned.length;
    for (const row of owned) {
      if (local.signal.aborted) return;
      const candidates = sessions.filter((session) => battuta(session)?.task_id === row.id);
      const session = candidates[0];
      const binding = session && battuta(session);
      if (
        !row.opencode_session_id ||
        candidates.length !== 1 ||
        session.id !== row.opencode_session_id ||
        binding?.schema_version !== 1 ||
        binding.worker_id !== config.workerId ||
        binding.delegator_role !== row.delegator_role ||
        Object.keys(binding).length !== 4
      ) {
        recovery(row.id, "missing, duplicate, unbound or conflicting session binding");
        blocked = true;
        continue;
      }
      let snapshot: ExecutionSnapshot;
      try {
        snapshot = await opencode.inspect(row, local.signal);
      } catch {
        recovery(row.id, "native execution inspection is unavailable or unsupported");
        throw new Error("Execution inspection unavailable");
      }
      if (
        !snapshot.valid ||
        !snapshot.initialInputAdmitted ||
        snapshot.session.id !== row.opencode_session_id ||
        snapshot.session.directory !== session.directory
      ) {
        recovery(row.id, "binding/location or original input admission is uncertain");
        blocked = true;
        continue;
      }
      if (snapshot.permissionsConcern || snapshot.pendingPermissions?.length) {
        recovery(row.id, "unsupported permission request or observed permission concern");
        blocked = true;
        continue;
      }
      if (snapshot.reportError) {
        recovery(row.id, "native terminal report is invalid or ambiguous");
        blocked = true;
      } else if (snapshot.pendingForms.length) {
        log(
          "waiting",
          `${row.id}: waiting for native question answer; ownership retained (FIS-50)`,
        );
        if (finalizations.has(row.id)) blocked = true;
      } else if (snapshot.report && !snapshot.active && !snapshot.pendingInputs.length) {
        const current = validateReport(snapshot.report, row.instruction);
        const cached = finalizations.get(row.id);
        if (cached && !isDeepStrictEqual(current, cached)) {
          recovery(
            row.id,
            "current native report differs from immutable pending finalization report",
          );
          blocked = true;
          continue;
        }
        await finalize(row, current);
        unfinished--;
      } else if (!snapshot.active && !snapshot.pendingInputs.length) {
        recovery(row.id, "inactive session without a validated native final report");
        blocked = true;
      } else if (finalizations.has(row.id)) {
        recovery(
          row.id,
          "native execution is not quiescent; pending finalization cannot be replayed",
        );
        blocked = true;
      }
    }
    if (blocked || local.signal.aborted) return;
    while (unfinished < config.capacity && !local.signal.aborted) {
      let row: TaskRow | null;
      try {
        row = await tasks.client.claim(projects, local.signal);
      } catch {
        uncertainClaim = true;
        recovery(
          "claim",
          "claim outcome is uncertain; ownership must be inspected before restarting admission",
        );
        throw new Error("Claim outcome uncertain");
      }
      if (!row || local.signal.aborted) return;
      unfinished++;
      if (
        row.claimed_by !== config.workerId ||
        !projects.includes(row.project) ||
        row.opencode_session_id !== null ||
        row.terminal_report !== null
      ) {
        uncertainClaim = true;
        recovery(row.id, "unexpected claim acknowledgement");
        return;
      }
      try {
        const directory = await options.prepareWorktree(row, config);
        if (local.signal.aborted) return;
        const session = await opencode.create(row, directory, local.signal);
        if (local.signal.aborted) return;
        const bound = await tasks.client.bind(row.id, session.id, local.signal);
        if (local.signal.aborted) return;
        await opencode.admit(bound, session.id, local.signal);
      } catch {
        recovery(
          row.id,
          "preparation/session/binding/admission outcome requires inspection; ownership retained",
        );
        throw new Error("Execution admission requires inspection");
      }
    }
  };
  try {
    if (local.signal.aborted) return;
    unsubscribe = await options.subscribeQueue(projects, wake, local.signal);
    eventPump = (async () => {
      while (!local.signal.aborted) {
        try {
          wake();
          for await (const event of opencode.events(local.signal)) {
            void event;
            wake();
            if (local.signal.aborted) break;
          }
        } catch {
          if (!local.signal.aborted)
            log(
              "service_unavailable",
              "OpenCode event stream disconnected; polling retained and reconnect bounded",
            );
        }
        if (!local.signal.aborted) await wait(config.reconcileMs, false);
      }
    })();
    while (!local.signal.aborted) {
      const now = clock.now();
      if (now < retryAt) {
        await wait(retryAt - now, false);
        continue;
      }
      if (!pending) {
        await wait(config.reconcileMs, true);
        if (local.signal.aborted) break;
      }
      pending = false;
      try {
        await reconcile();
        failures = 0;
      } catch {
        if (!local.signal.aborted) {
          failures++;
          pending = true;
          retryAt =
            clock.now() + Math.min(30000, config.reconcileMs * 2 ** Math.min(failures - 1, 5));
          log(
            "service_unavailable",
            "Reconciliation failed; admission paused, retained ownership; bounded retry without inferring task failure",
          );
        }
      }
    }
  } finally {
    local.abort();
    signal.removeEventListener("abort", abort);
    try {
      await unsubscribe?.();
    } finally {
      await opencode.close();
      await eventPump;
    }
  }
}
