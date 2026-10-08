import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runDaemon, type DaemonOptions } from "../daemon.ts";
import type { ExecutionSnapshot, SessionInfo, OpenCodeAdapter } from "../opencode.ts";
import type { TaskRow, TerminalReport } from "../../supabase/functions/_shared/task-contracts.ts";
import { task, report } from "./fixtures.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => vi.advanceTimersByTimeAsync(0);
type Functions<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : T[K];
};
type TestOptions = Omit<DaemonOptions, "tasks" | "opencode"> & {
  tasks: {
    principal: DaemonOptions["tasks"]["principal"];
    client: Functions<DaemonOptions["tasks"]["client"]>;
  };
  opencode: Functions<OpenCodeAdapter>;
};
function fixture(capacity = 1) {
  const controller = new AbortController();
  const owned: TaskRow[] = [];
  const queue: TaskRow[] = [];
  const sessions: SessionInfo[] = [];
  const snapshots = new Map<string, Partial<ExecutionSnapshot>>();
  let wake = () => {};
  const log = vi.fn();
  const cleanup = vi.fn();
  const options: TestOptions = {
    config: {
      workerId: "worker-1",
      projects: { [task.project]: { checkout: "/repo", baseRef: "HEAD" } },
      worktreeRoot: "/work",
      lockPath: "/lock",
      capacity,
      reconcileMs: 1000,
    },
    tasks: {
      principal: { role: "worker", worker_id: "worker-1", projects: [task.project] },
      client: {
        listOwned: vi.fn(() => Promise.resolve({ tasks: [...owned], next: null })),
        claim: vi.fn(() => {
          const next = queue.shift() ?? null;
          if (next) owned.push(next);
          return Promise.resolve(next);
        }),
        bind: vi.fn((id: string, sessionId: string) => {
          const value = owned.find((row) => row.id === id)!;
          value.opencode_session_id = sessionId;
          return Promise.resolve(value);
        }),
        finalize: vi.fn((id: string, result: TerminalReport) => {
          const index = owned.findIndex((row) => row.id === id);
          const value = owned.splice(index, 1)[0];
          return Promise.resolve({ ...value, terminal_report: result });
        }),
      },
    },
    opencode: {
      listSessions: vi.fn(() => Promise.resolve(sessions)),
      create: vi.fn((row: TaskRow, directory: string) => {
        const value = {
          id: `ses_${row.id}`,
          directory,
          metadata: {
            battuta: {
              schema_version: 1,
              task_id: row.id,
              worker_id: "worker-1",
              delegator_role: row.delegator_role,
            },
          },
        };
        sessions.push(value);
        return Promise.resolve(value);
      }),
      admit: vi.fn(() => Promise.resolve()),
      inspect: vi.fn((row: TaskRow) =>
        Promise.resolve({
          session: sessions.find((value) => value.id === row.opencode_session_id)!,
          valid: true,
          active: true,
          pendingInputs: [],
          pendingForms: [],
          pendingPermissions: [],
          initialInputAdmitted: true,
          ...snapshots.get(row.id),
        }),
      ),
      events: async function* (signal) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        yield { type: "closed" };
      },
      close: vi.fn(() => Promise.resolve()),
    },
    prepareWorktree: vi.fn((row: TaskRow) => Promise.resolve(`/work/${row.id}`)),
    subscribeQueue: (_projects, callback) => {
      wake = callback;
      callback();
      return Promise.resolve(cleanup);
    },
    log,
  };
  const existing = () => {
    const row = structuredClone(task);
    row.opencode_session_id = `ses_${row.id}`;
    owned.push(row);
    sessions.push({
      id: row.opencode_session_id,
      directory: `/work/${row.id}`,
      metadata: {
        battuta: {
          schema_version: 1,
          task_id: row.id,
          worker_id: "worker-1",
          delegator_role: "tl",
        },
      },
    });
    return row;
  };
  return {
    options,
    owned,
    queue,
    sessions,
    snapshots,
    log,
    cleanup,
    existing,
    wake: () => wake(),
    start: () => {
      const running = runDaemon(options, controller.signal);
      void running.catch(() => {});
      return running;
    },
    stop: () => controller.abort(),
  };
}

it("executes a claim in order, finalizes native report and accepts the next task", async () => {
  const f = fixture();
  f.queue.push(structuredClone(task));
  const running = f.start();
  await settle();
  expect(f.options.prepareWorktree).toHaveBeenCalledTimes(1);
  expect(f.options.tasks.client.bind).toHaveBeenCalledWith(
    task.id,
    `ses_${task.id}`,
    expect.any(AbortSignal),
  );
  expect(f.options.opencode.admit).toHaveBeenCalledWith(
    expect.objectContaining({ opencode_session_id: `ses_${task.id}` }),
    `ses_${task.id}`,
    expect.any(AbortSignal),
  );
  f.snapshots.set(task.id, { active: false, report });
  f.queue.push({ ...structuredClone(task), id: "22345678-1234-1234-1234-123456789abc" });
  f.wake();
  await settle();
  expect(f.options.tasks.client.finalize).toHaveBeenCalledWith(
    task.id,
    report,
    expect.any(AbortSignal),
  );
  expect(f.options.opencode.create).toHaveBeenCalledTimes(2);
  f.stop();
  await running;
  expect(f.cleanup).toHaveBeenCalledOnce();
  expect(f.options.opencode.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("serializes coalesced wakeups and respects configurable capacity", async () => {
  const f = fixture(2);
  f.queue.push(
    structuredClone(task),
    { ...structuredClone(task), id: "22345678-1234-1234-1234-123456789abc" },
    { ...structuredClone(task), id: "32345678-1234-1234-1234-123456789abc" },
  );
  let release!: () => void;
  vi.mocked(f.options.prepareWorktree).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "/work/task";
  });
  const running = f.start();
  await settle();
  for (let n = 0; n < 30; n++) f.wake();
  expect(f.options.tasks.client.claim).toHaveBeenCalledTimes(1);
  release();
  await settle();
  expect(f.owned).toHaveLength(2);
  expect(f.options.opencode.create).toHaveBeenCalledTimes(2);
  f.stop();
  await running;
});

it.each([
  [
    "missing session",
    (f: ReturnType<typeof fixture>) => {
      f.sessions.length = 0;
    },
  ],
  [
    "duplicate binding",
    (f: ReturnType<typeof fixture>) => {
      f.sessions.push({ ...f.sessions[0], id: "other" });
    },
  ],
  [
    "wrong worker metadata",
    (f: ReturnType<typeof fixture>) => {
      f.sessions[0].metadata = {
        battuta: { schema_version: 1, task_id: task.id, worker_id: "other", delegator_role: "tl" },
      };
    },
  ],
  [
    "wrong delegator metadata",
    (f: ReturnType<typeof fixture>) => {
      f.sessions[0].metadata = {
        battuta: {
          schema_version: 1,
          task_id: task.id,
          worker_id: "worker-1",
          delegator_role: "pm",
        },
      };
    },
  ],
  [
    "unbound",
    (f: ReturnType<typeof fixture>) => {
      f.owned[0].opencode_session_id = null;
    },
  ],
  [
    "input uncertainty",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { initialInputAdmitted: false });
    },
  ],
  [
    "location uncertainty",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { valid: false });
    },
  ],
  [
    "permissions concern",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { permissionsConcern: "deny" });
    },
  ],
  [
    "pending permission",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { pendingPermissions: [{}] });
    },
  ],
  [
    "idle without report",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { active: false });
    },
  ],
  [
    "invalid report",
    (f: ReturnType<typeof fixture>) => {
      f.snapshots.set(task.id, { reportError: "invalid" });
    },
  ],
] as const)("startup %s prevents admission without repair", async (_name, mutate) => {
  const f = fixture(2);
  f.existing();
  mutate(f);
  const running = f.start();
  await settle();
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  expect(f.options.opencode.admit).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith("recovery_required", expect.any(String));
  f.stop();
  await running;
});

it("paginates all unfinished owned tasks including pending forms before deciding capacity", async () => {
  const f = fixture(2);
  const first = f.existing();
  const second = {
    ...first,
    id: "22345678-1234-1234-1234-123456789abc",
    opencode_session_id: "ses_second",
  };
  f.sessions.push({
    ...f.sessions[0],
    id: "ses_second",
    metadata: {
      battuta: {
        schema_version: 1,
        task_id: second.id,
        worker_id: "worker-1",
        delegator_role: "tl",
      },
    },
  });
  vi.mocked(f.options.tasks.client.listOwned).mockImplementation((cursor) =>
    Promise.resolve(cursor ? { tasks: [second], next: null } : { tasks: [first], next: "page2" }),
  );
  f.snapshots.set(first.id, { active: false, pendingForms: [{}] });
  const running = f.start();
  await settle();
  expect(f.options.tasks.client.listOwned).toHaveBeenCalledWith("page2", expect.any(AbortSignal));
  expect(f.options.opencode.inspect).toHaveBeenCalledTimes(2);
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith("waiting", expect.any(String));
  f.stop();
  await running;
});

it.each(["create", "admit"] as const)(
  "uncertain %s never retries execution or infers task failure",
  async (operation) => {
    const f = fixture(2);
    f.queue.push(structuredClone(task));
    vi.mocked(f.options.opencode[operation]).mockRejectedValue(new Error("timeout"));
    const running = f.start();
    await settle();
    f.snapshots.set(task.id, { initialInputAdmitted: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.options.opencode[operation]).toHaveBeenCalledTimes(1);
    expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
    expect(f.owned).toHaveLength(1);
    f.stop();
    await running;
  },
);

it("retries finalization only with identical report after bounded backoff", async () => {
  const f = fixture();
  f.existing();
  f.snapshots.set(task.id, { active: false, report });
  const finalize = f.options.tasks.client.finalize;
  vi.mocked(finalize).mockRejectedValueOnce(new Error("network"));
  const running = f.start();
  await settle();
  for (let n = 0; n < 30; n++) f.wake();
  await settle();
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  f.snapshots.set(task.id, { active: false, report: structuredClone(report) });
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.mocked(finalize).mock.calls.map((call) => call[1])).toEqual([report, report]);
  f.stop();
  await running;
});

it.each([
  { name: "resumed active execution", snapshot: { active: true }, diagnostic: "recovery_required" },
  { name: "pending question", snapshot: { pendingForms: [{}] }, diagnostic: "waiting" },
  { name: "pending input", snapshot: { pendingInputs: [{}] }, diagnostic: "recovery_required" },
  {
    name: "pending permission",
    snapshot: { pendingPermissions: [{}] },
    diagnostic: "recovery_required",
  },
  {
    name: "permission concern",
    snapshot: { permissionsConcern: "deny" },
    diagnostic: "recovery_required",
  },
  {
    name: "parse error",
    snapshot: { reportError: "invalid final text" },
    diagnostic: "recovery_required",
  },
  {
    name: "missing native report",
    snapshot: { report: undefined },
    diagnostic: "recovery_required",
  },
  {
    name: "changed native report",
    snapshot: { report: { ...report, summary: "changed" } },
    diagnostic: "recovery_required",
  },
] satisfies { name: string; snapshot: Partial<ExecutionSnapshot>; diagnostic: string }[])(
  "failed finalization cannot bypass current native gates: $name",
  async ({ snapshot, diagnostic }) => {
    const f = fixture(2);
    f.existing();
    f.snapshots.set(task.id, { active: false, report });
    const finalize = f.options.tasks.client.finalize;
    vi.mocked(finalize).mockRejectedValueOnce(new Error("lost acknowledgement"));
    const running = f.start();
    await settle();
    f.snapshots.set(task.id, { active: false, report, ...snapshot });
    await vi.advanceTimersByTimeAsync(1000);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(f.log).toHaveBeenCalledWith(diagnostic, expect.stringContaining(task.id));
    expect(f.owned).toHaveLength(1);
    expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
    // Resolving native blockers may permit replay, but never replace the immutable cached payload.
    f.snapshots.set(task.id, { active: false, report: structuredClone(report) });
    f.wake();
    await settle();
    expect(vi.mocked(finalize).mock.calls.map((call) => call[1])).toEqual([report, report]);
    f.stop();
    await running;
  },
);

it("prunes lost-ack finalization only after the full paginated ownership scan confirms disappearance", async () => {
  const f = fixture();
  f.existing();
  f.snapshots.set(task.id, { active: false, report });
  vi.mocked(f.options.tasks.client.finalize).mockImplementationOnce(() => {
    f.owned.length = 0;
    return Promise.reject(new Error("committed but acknowledgement lost"));
  });
  const running = f.start();
  await settle();
  let finishPage!: () => void;
  vi.mocked(f.options.tasks.client.listOwned).mockImplementation(async (cursor) => {
    if (!cursor) return { tasks: [], next: "last" };
    await new Promise<void>((resolve) => {
      finishPage = resolve;
    });
    return { tasks: [], next: null };
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.log).not.toHaveBeenCalledWith("finalization_reconciled", expect.any(String));
  finishPage();
  await settle();
  expect(f.log).toHaveBeenCalledWith("finalization_reconciled", expect.stringContaining(task.id));
  expect(f.options.tasks.client.finalize).toHaveBeenCalledOnce();
  f.stop();
  await running;
});

it("aborted partial ownership scan never prunes a pending finalization", async () => {
  const f = fixture();
  f.existing();
  f.snapshots.set(task.id, { active: false, report });
  vi.mocked(f.options.tasks.client.finalize).mockRejectedValueOnce(new Error("network"));
  const running = f.start();
  await settle();
  let finishPage!: () => void;
  vi.mocked(f.options.tasks.client.listOwned).mockImplementation(async (cursor) => {
    if (!cursor) return { tasks: [], next: "last" };
    await new Promise<void>((resolve) => {
      finishPage = resolve;
    });
    return { tasks: [], next: null };
  });
  await vi.advanceTimersByTimeAsync(1000);
  f.stop();
  finishPage();
  await running;
  expect(f.log).not.toHaveBeenCalledWith("finalization_reconciled", expect.any(String));
  expect(f.options.tasks.client.finalize).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["first page", "partial page"])(
  "failed %s ownership scan never prunes cached payload",
  async (failure) => {
    const f = fixture();
    const row = f.existing();
    f.snapshots.set(task.id, { active: false, report });
    vi.mocked(f.options.tasks.client.finalize).mockRejectedValueOnce(new Error("network"));
    const running = f.start();
    await settle();
    vi.mocked(f.options.tasks.client.listOwned).mockImplementation((cursor) => {
      if (failure === "first page" || cursor) return Promise.reject(new Error("page unavailable"));
      return Promise.resolve({ tasks: [], next: "last" });
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.log).not.toHaveBeenCalledWith("finalization_reconciled", expect.any(String));
    vi.mocked(f.options.tasks.client.listOwned).mockResolvedValue({ tasks: [row], next: null });
    f.snapshots.set(task.id, { active: false, report: { ...report, summary: "changed" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.options.tasks.client.finalize).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalledWith("recovery_required", expect.stringContaining("differs"));
    f.snapshots.set(task.id, { active: false, report: structuredClone(report) });
    f.wake();
    await settle();
    expect(vi.mocked(f.options.tasks.client.finalize).mock.calls.map((call) => call[1])).toEqual([
      report,
      report,
    ]);
    f.stop();
    await running;
  },
);

it.each([
  { role: "worker", worker_id: "other", projects: [task.project] },
  { role: "worker", worker_id: "worker-1", projects: [] },
  { role: "pm", projects: [task.project] },
] as const)("rejects mismatched signed authority before claims", async (principal) => {
  const f = fixture();
  f.options.tasks.principal = { ...principal, projects: [...principal.projects] };
  await expect(f.start()).rejects.toThrow(/authority/);
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
});

it("null claim waits for a wakeup instead of busy looping", async () => {
  const f = fixture();
  const running = f.start();
  await settle();
  const count = vi.mocked(f.options.tasks.client.claim).mock.calls.length;
  await vi.advanceTimersByTimeAsync(999);
  expect(f.options.tasks.client.claim).toHaveBeenCalledTimes(count);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.options.tasks.client.claim).toHaveBeenCalledTimes(count + 1);
  f.stop();
  await running;
});

it("startup reports finalize without new sessions or prompt admission", async () => {
  const f = fixture();
  f.existing();
  f.snapshots.set(task.id, { active: false, report });
  const running = f.start();
  await settle();
  expect(f.options.tasks.client.finalize).toHaveBeenCalledOnce();
  expect(f.options.opencode.create).not.toHaveBeenCalled();
  expect(f.options.opencode.admit).not.toHaveBeenCalled();
  f.stop();
  await running;
});

it("pending question retains ownership but permits another slot at higher capacity", async () => {
  const f = fixture(2);
  f.existing();
  f.snapshots.set(task.id, { active: false, pendingForms: [{ question: "Which choice?" }] });
  f.queue.push({ ...structuredClone(task), id: "22345678-1234-1234-1234-123456789abc" });
  const running = f.start();
  await settle();
  expect(f.owned).toHaveLength(2);
  expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith("waiting", expect.stringContaining("FIS-50"));
  f.stop();
  await running;
});

it("read outage backs off under notification storms and recovers via periodic inspection", async () => {
  const f = fixture();
  vi.mocked(f.options.tasks.client.listOwned).mockRejectedValueOnce(new Error("network"));
  const running = f.start();
  await settle();
  for (let n = 0; n < 100; n++) f.wake();
  await settle();
  expect(f.options.tasks.client.listOwned).toHaveBeenCalledTimes(1);
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(999);
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.options.tasks.client.claim).toHaveBeenCalledOnce();
  f.stop();
  await running;
});

it("unknown claim response never retries claim even when owned listing is empty", async () => {
  const f = fixture();
  vi.mocked(f.options.tasks.client.claim).mockRejectedValueOnce(new Error("timeout"));
  const running = f.start();
  await settle();
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.options.tasks.client.claim).toHaveBeenCalledOnce();
  expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
  expect(f.log).toHaveBeenCalledWith("recovery_required", expect.stringContaining("claim"));
  f.stop();
  await running;
});

it("failed binding preserves session, never rebinds or admits without durable input proof", async () => {
  const f = fixture(2);
  f.queue.push(structuredClone(task));
  vi.mocked(f.options.tasks.client.bind).mockRejectedValue(new Error("timeout"));
  const running = f.start();
  await settle();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.sessions).toHaveLength(1);
  expect(f.options.tasks.client.bind).toHaveBeenCalledOnce();
  expect(f.options.opencode.admit).not.toHaveBeenCalled();
  expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
  f.stop();
  await running;
});

it.each(["repeated cursor", "duplicate row", "wrong owner", "unmapped project"])(
  "invalid owned pagination fails closed: %s",
  async (reason) => {
    const f = fixture(2);
    const row = f.existing();
    vi.mocked(f.options.tasks.client.listOwned).mockImplementation(() =>
      Promise.resolve({
        tasks:
          reason === "repeated cursor"
            ? []
            : reason === "duplicate row"
              ? [row, row]
              : [
                  {
                    ...row,
                    claimed_by: reason === "wrong owner" ? "other" : row.claimed_by,
                    project: reason === "unmapped project" ? "Unknown" : row.project,
                  },
                ],
        next: reason === "repeated cursor" ? "again" : null,
      }),
    );
    const running = f.start();
    await settle();
    expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
    expect(f.options.opencode.admit).not.toHaveBeenCalled();
    f.stop();
    await running;
  },
);

it("stream events and re-establishment wake inspection with bounded reconnect", async () => {
  const f = fixture();
  let streams = 0;
  f.options.opencode.events = async function* (signal) {
    streams++;
    if (streams === 1) {
      yield { type: "updated" };
      throw new Error("disconnected");
    }
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const running = f.start();
  await settle();
  expect(streams).toBe(1);
  const count = vi.mocked(f.options.tasks.client.listOwned).mock.calls.length;
  await vi.advanceTimersByTimeAsync(999);
  expect(streams).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(streams).toBe(2);
  expect(vi.mocked(f.options.tasks.client.listOwned).mock.calls.length).toBeGreaterThan(count);
  f.stop();
  await running;
  expect(vi.getTimerCount()).toBe(0);
});

it("shutdown during preparation does not create session or clean retained worktree", async () => {
  const f = fixture();
  f.queue.push(structuredClone(task));
  let release!: () => void;
  vi.mocked(f.options.prepareWorktree).mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "/work/retained";
  });
  const running = f.start();
  await settle();
  f.stop();
  release();
  await running;
  expect(f.owned).toHaveLength(1);
  expect(f.options.opencode.create).not.toHaveBeenCalled();
  expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("uncertain admission can only resume monitoring after durable proof, never resubmit", async () => {
  const f = fixture(2);
  f.queue.push(structuredClone(task));
  vi.mocked(f.options.opencode.admit).mockRejectedValueOnce(new Error("timeout"));
  const running = f.start();
  await settle();
  f.queue.push({ ...structuredClone(task), id: "22345678-1234-1234-1234-123456789abc" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.options.opencode.admit).toHaveBeenCalledTimes(2);
  expect(
    vi.mocked(f.options.opencode.admit).mock.calls.filter(([row]) => row.id === task.id),
  ).toHaveLength(1);
  expect(f.owned).toHaveLength(2);
  f.stop();
  await running;
});
it("stopping before startup never subscribes or claims", async () => {
  const f = fixture();
  f.stop();
  await f.start();
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  expect(f.options.opencode.listSessions).not.toHaveBeenCalled();
  expect(f.options.opencode.close).toHaveBeenCalledOnce();
});
it("shutdown during session creation retains unbound session and never binds/adopts it", async () => {
  const f = fixture();
  f.queue.push(structuredClone(task));
  const create = f.options.opencode.create;
  vi.mocked(create).mockImplementation(() => {
    f.stop();
    return Promise.resolve({ id: "ses_retained", directory: "/work", metadata: {} });
  });
  const running = f.start();
  await running;
  expect(f.options.tasks.client.bind).not.toHaveBeenCalled();
  expect(f.options.opencode.admit).not.toHaveBeenCalled();
  expect(f.owned).toHaveLength(1);
});
it("native inspection transport/unsupported-state error reports recovery, preserves ownership and pauses claims", async () => {
  const f = fixture(2);
  f.existing();
  vi.mocked(f.options.opencode.inspect).mockRejectedValue(new Error("unsupported active envelope"));
  const running = f.start();
  await settle();
  expect(f.log).toHaveBeenCalledWith("recovery_required", expect.stringContaining(task.id));
  expect(f.options.tasks.client.claim).not.toHaveBeenCalled();
  expect(f.options.tasks.client.finalize).not.toHaveBeenCalled();
  f.stop();
  await running;
});
it("unexpected claim acknowledgement pauses forever without executing or retrying", async () => {
  const f = fixture();
  vi.mocked(f.options.tasks.client.claim).mockResolvedValue({ ...task, claimed_by: "wrong" });
  const running = f.start();
  await settle();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.options.tasks.client.claim).toHaveBeenCalledOnce();
  expect(f.options.prepareWorktree).not.toHaveBeenCalled();
  f.stop();
  await running;
});
