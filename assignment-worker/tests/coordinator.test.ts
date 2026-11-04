import { expect, test, vi } from "vitest";
import { createCoordinator } from "../coordinator.ts";
import { AssignmentRefusalError, UncertainAssignmentWriteError } from "../client.ts";
import type {
  AssignmentClient,
  Binding,
  Claim,
  ExecutionResult,
  TodoTarget,
  Detail,
  MailDelivery,
} from "../types.ts";
import { detail } from "./fixtures.ts";

function harness(count = 2) {
  const state = detail();
  state.todos = Array.from({ length: count }, (_, i) => ({
    ...state.todos[0],
    position: i + 1,
    description: `Step ${i + 1}`,
  }));
  const turns: { binding: Binding; position: number }[] = [];
  const opened: Binding[] = [];
  const notifications: Detail[] = [];
  const entries: { kind: string; data: unknown }[] = [];
  const diagnostics = vi.fn();
  let idle = true,
    pending = false,
    tick = 2;
  const clone = <T>(value: T): T => structuredClone(value);
  const stamp = () => `2026-11-04T12:00:00.${String(tick++).padStart(6, "0")}Z`;
  const requireClaim = (input: Claim) => {
    if (
      state.assignment.status !== "in_process" ||
      input.claimed_at !== state.assignment.claimed_at
    )
      throw new AssignmentRefusalError({
        ok: false,
        code: "stale_claim",
        message: "Claim replaced",
        assignment: clone(state.assignment),
      });
  };
  const assignments = {
    list: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        assignments: state.assignment.status === "active" ? [clone(state.assignment)] : [],
      }),
    ),
    get: vi.fn(() => Promise.resolve(clone(state))),
    claim: vi.fn(() => {
      state.assignment.status = "in_process";
      state.assignment.ready = false;
      state.assignment.claimed_at = stamp();
      state.assignment.lease_expired_at = "2026-11-04T12:45:00.000002Z";
      return Promise.resolve(clone(state));
    }),
    start: vi.fn((input: TodoTarget) => {
      requireClaim(input);
      const todo = state.todos.find((t) => t.position === input.position)!;
      todo.status = "in_progress";
      todo.updated_at = stamp();
      return Promise.resolve({
        ok: true as const,
        assignment: clone(state.assignment),
        todo: clone(todo),
      });
    }),
    record: vi.fn((input: TodoTarget & ExecutionResult) => {
      requireClaim(input);
      const todo = state.todos.find((t) => t.position === input.position)!;
      todo.status = input.outcome === "completed" ? "done" : "blocked";
      todo.outcome = input.summary;
      todo.evidence = clone(input.evidence);
      todo.updated_at = stamp();
      todo.blocker = input.outcome === "blocked" ? input.blocker : null;
      if (input.outcome === "blocked") {
        state.assignment.status = "blocked";
        state.assignment.blocker = input.blocker;
      }
      return Promise.resolve({
        ok: true as const,
        assignment: clone(state.assignment),
        todo: clone(todo),
      });
    }),
    block: vi.fn((input: Claim & { blocker: string }) => {
      requireClaim(input);
      state.assignment.status = "blocked";
      state.assignment.blocker = input.blocker;
      const todo = state.todos.find((t) => t.status === "in_progress");
      if (todo) {
        todo.status = "blocked";
        todo.blocker = input.blocker;
      }
      return Promise.resolve({ ok: true as const, assignment: clone(state.assignment) });
    }),
    finish: vi.fn((input: Claim) => {
      requireClaim(input);
      state.assignment.status = "done";
      state.assignment.closed_at = stamp();
      return Promise.resolve({ ok: true as const, assignment: clone(state.assignment) });
    }),
    close: vi.fn(() => Promise.resolve()),
  } satisfies AssignmentClient;
  const sessions = {
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    openAssignmentSession: vi.fn((d: Detail) => {
      const binding = {
        project: d.assignment.project,
        assignment_id: d.assignment.id,
        claimed_at: d.assignment.claimed_at!,
        session_file: "/private/test-session.jsonl",
      };
      opened.push(binding);
      return Promise.resolve(binding);
    }),
    runTodo: vi.fn((binding: Binding, todo: { position: number }) => {
      turns.push({ binding, position: todo.position });
      return Promise.resolve();
    }),
    appendEntry: (kind: string, data: unknown) => {
      entries.push({ kind, data: clone(data) });
    },
  };
  const notify = vi.fn((d: Detail) => {
    notifications.push(clone(d));
    return Promise.resolve<MailDelivery>({
      state: "sent",
      reference: { conversation_id: "11111111-1111-4111-8111-111111111111", id: "123456abcdef" },
    });
  });
  const coordinator = createCoordinator({ assignments, sessions, diagnostics, notify });
  return {
    state,
    assignments,
    sessions,
    coordinator,
    turns,
    opened,
    notifications,
    entries,
    diagnostics,
    notify,
    busy: (value: boolean) => {
      idle = !value;
    },
    pending: (value: boolean) => {
      pending = value;
    },
    async begin() {
      await coordinator.reconcile("startup");
      await coordinator.restoreBinding(opened[0]);
    },
    async complete() {
      await coordinator.acceptReport({
        outcome: "completed",
        summary: "Verified",
        evidence: ["proof"],
      });
      coordinator.observeBoundary("completed");
      await coordinator.settle({ aborted: false });
    },
  };
}

test("claims before prompting and runs TODOs sequentially before persistence-owned completion", async () => {
  const h = harness();
  await h.coordinator.reconcile("startup");
  expect(h.state.assignment.status).toBe("in_process");
  expect(h.turns).toEqual([]); // handoff has not restored the fresh context yet
  await h.coordinator.restoreBinding(h.opened[0]);
  expect(h.turns.map((t) => t.position)).toEqual([1]);
  await h.complete();
  expect(h.state.todos[0].status).toBe("done");
  expect(h.turns.map((t) => t.position)).toEqual([1, 2]);
  expect(h.notifications).toEqual([]);
  await h.complete();
  expect(h.state.assignment.status).toBe("done");
  expect(h.notifications.map((d) => d.assignment.status)).toEqual(["done"]);
});

test("busy and pending contexts coalesce wakeups without a second binding", async () => {
  const h = harness();
  h.busy(true);
  await Promise.all(Array.from({ length: 8 }, () => h.coordinator.reconcile("event")));
  expect(h.opened).toEqual([]);
  h.busy(false);
  h.pending(true);
  await h.coordinator.reconcile("idle");
  expect(h.opened).toEqual([]);
  h.pending(false);
  await h.begin();
  await Promise.all(Array.from({ length: 8 }, () => h.coordinator.reconcile("event")));
  expect(h.opened).toHaveLength(1);
  expect(h.turns).toHaveLength(1);
});

test("empty boards and known contention do not invoke the model", async () => {
  const h = harness();
  h.state.assignment.status = "done";
  await h.coordinator.reconcile("startup");
  expect(h.turns).toEqual([]);
  h.state.assignment.status = "active";
  h.assignments.claim.mockRejectedValue(
    new AssignmentRefusalError({
      ok: false,
      code: "not_claimable",
      message: "Lost race",
      assignment: h.state.assignment,
      reason: "claimed",
    }),
  );
  await h.coordinator.reconcile("event");
  expect(h.opened).toEqual([]);
});

test("malformed reports are correctable, duplicates are idempotent and accepted evidence is immutable", async () => {
  const h = harness(1);
  await h.begin();
  await expect(
    h.coordinator.acceptReport({ outcome: "blocked", summary: "Missing", evidence: [] }),
  ).rejects.toThrow();
  const report = { outcome: "completed", summary: "Verified", evidence: ["proof"] };
  await h.coordinator.acceptReport(report);
  await h.coordinator.acceptReport(structuredClone(report));
  await expect(h.coordinator.acceptReport({ ...report, summary: "Different" })).rejects.toThrow();
  report.evidence.push("unaccepted");
  h.coordinator.observeBoundary("completed");
  await h.coordinator.settle({ aborted: false });
  expect(h.state.todos[0].evidence).toEqual(["proof"]);
  expect(h.notifications).toHaveLength(1);
});

test.each(["error", "aborted"] as const)(
  "final %s wins over a submitted success report",
  async (outcome) => {
    const h = harness();
    await h.begin();
    await h.coordinator.acceptReport({
      outcome: "completed",
      summary: "Claimed success",
      evidence: [],
    });
    h.coordinator.observeBoundary(outcome);
    await h.coordinator.settle({ aborted: outcome === "aborted" });
    expect(h.state.assignment.status).toBe("blocked");
    expect(h.state.todos[0].status).toBe("blocked");
    expect(h.turns).toHaveLength(1);
    expect(h.notifications[0].assignment.status).toBe("blocked");
  },
);

test("a corrected retry may complete, but final prose without a report blocks", async () => {
  const good = harness(1);
  await good.begin();
  good.coordinator.observeBoundary("error");
  await good.complete();
  expect(good.state.assignment.status).toBe("done");
  const missing = harness(1);
  await missing.begin();
  missing.coordinator.observeBoundary("completed");
  await missing.coordinator.settle({ aborted: false });
  expect(missing.state.assignment.status).toBe("blocked");
  expect(missing.notifications).toHaveLength(1);
});

test("blocked reports stop the assignment without rewriting future TODOs", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.acceptReport({
    outcome: "blocked",
    summary: "Investigated",
    evidence: [],
    blocker: "Missing authority",
  });
  h.coordinator.observeBoundary("completed");
  await h.coordinator.settle({ aborted: false });
  expect(h.state.assignment.blocker).toBe("Missing authority");
  expect(h.state.todos.map((t) => t.status)).toEqual(["blocked", "todo"]);
  expect(h.notifications[0].todos[1].status).toBe("todo");
});

test("obsolete claims stop without completion mail or recovery claims", async () => {
  const h = harness();
  await h.begin();
  h.state.assignment.status = "cancelled";
  await h.coordinator.acceptReport({ outcome: "completed", summary: "Late", evidence: [] });
  h.coordinator.observeBoundary("completed");
  await h.coordinator.settle({ aborted: false });
  await h.coordinator.reconcile("fallback");
  expect(h.state.assignment.status).toBe("cancelled");
  expect(h.notifications).toEqual([]);
  expect(h.opened).toHaveLength(1);
});

test("uncertain claims pause with one attempt and no inferred ownership", async () => {
  const h = harness();
  h.assignments.claim.mockRejectedValue(new UncertainAssignmentWriteError("Unknown"));
  await h.coordinator.reconcile("startup");
  await h.coordinator.reconcile("fallback");
  expect(h.assignments.claim).toHaveBeenCalledTimes(1);
  expect(h.turns).toEqual([]);
  expect(h.diagnostics).toHaveBeenCalled();
});

test.each([true, false])(
  "uncertain result confirms exact persisted evidence or pauses (committed=%s)",
  async (committed) => {
    const h = harness(1);
    await h.begin();
    const original = h.assignments.record.getMockImplementation()!;
    h.assignments.record.mockImplementation((input) => {
      if (committed) void original(input);
      return Promise.reject(new UncertainAssignmentWriteError("Unknown result"));
    });
    await h.complete();
    expect(h.state.assignment.status).toBe(committed ? "done" : "in_process");
    expect(h.notifications).toHaveLength(committed ? 1 : 0);
    expect(h.assignments.record).toHaveBeenCalledTimes(1);
  },
);

test("backend outage while blocking keeps owned work paused and never fabricates remote status", async () => {
  const h = harness();
  await h.begin();
  h.assignments.block.mockRejectedValue(new Error("Offline"));
  h.coordinator.observeBoundary("error");
  await h.coordinator.settle({ aborted: false });
  await h.coordinator.reconcile("fallback");
  expect(h.state.assignment.status).toBe("in_process");
  expect(h.notifications).toEqual([]);
  expect(h.opened).toHaveLength(1);
});

test("late current claims ignore informational lease age and skip terminal TODOs", async () => {
  const h = harness(3);
  h.state.todos[0].status = "done";
  h.state.todos[1].status = "cancelled";
  const claim = h.assignments.claim.getMockImplementation()!;
  h.assignments.claim.mockImplementation(() =>
    claim().then((d) => {
      h.state.assignment.claimed_at = "2000-01-01T00:00:00.000001Z";
      h.state.assignment.lease_expired_at = "2000-01-01T00:45:00.000001Z";
      return { ...d, assignment: structuredClone(h.state.assignment) };
    }),
  );
  await h.coordinator.reconcile("startup");
  await h.coordinator.restoreBinding(h.opened[0]);
  expect(h.turns.map((t) => t.position)).toEqual([3]);
  await h.complete();
  expect(h.state.assignment.status).toBe("done");
});

test("duplicate handoff cannot restart the executing TODO or replace its identity", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.restoreBinding(h.opened[0]);
  expect(h.turns).toHaveLength(1);
  await expect(
    h.coordinator.restoreBinding({ ...h.opened[0], assignment_id: "ffffffff" }),
  ).rejects.toThrow();
  await h.complete();
  expect(h.turns.map((t) => t.position)).toEqual([1, 2]);
});

test("a prompt promise may span tool reporting without deadlocking the control queue", async () => {
  const h = harness(1);
  let release: (() => void) | undefined;
  h.sessions.runTodo.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await h.begin();
  await h.complete();
  expect(h.state.assignment.status).toBe("done");
  release?.();
});

test("stop invalidates callbacks immediately and never releases a claim", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.stop();
  h.coordinator.observeBoundary("error");
  await h.coordinator.settle({ aborted: true });
  await h.coordinator.reconcile("event");
  expect(h.state.assignment.status).toBe("in_process");
  expect(h.notifications).toEqual([]);
});

test("return to idle reconciles the board even if the availability event was missed", async () => {
  const h = harness(1);
  await h.begin();
  await h.complete();
  await vi.waitFor(() => expect(h.assignments.list).toHaveBeenCalledTimes(2));
  expect(h.turns).toHaveLength(1);
});

test("conversation or prompt startup failures become honest persisted blockers", async () => {
  const conversation = harness();
  conversation.sessions.openAssignmentSession.mockRejectedValue(
    new Error("Session initialization failed"),
  );
  await conversation.coordinator.reconcile("startup");
  expect(conversation.state.assignment.status).toBe("blocked");
  expect(conversation.notifications[0].assignment.status).toBe("blocked");
  expect(conversation.turns).toEqual([]);
  const prompt = harness();
  prompt.sessions.runTodo.mockRejectedValue(new Error("Provider unavailable"));
  await prompt.begin();
  await vi.waitFor(() => expect(prompt.state.assignment.status).toBe("blocked"));
  expect(prompt.state.todos[1].status).toBe("todo");
});

test.each([true, false])(
  "uncertain finish is inspected before notification (committed=%s)",
  async (committed) => {
    const h = harness(1);
    await h.begin();
    const original = h.assignments.finish.getMockImplementation()!;
    h.assignments.finish.mockImplementation((input) => {
      if (committed) void original(input);
      return Promise.reject(new UncertainAssignmentWriteError("Finish acknowledgement lost"));
    });
    await h.complete();
    expect(h.state.assignment.status).toBe(committed ? "done" : "in_process");
    expect(h.notifications).toHaveLength(committed ? 1 : 0);
    expect(h.turns).toHaveLength(1);
  },
);

test.each(["failed", "uncertain"] as const)(
  "%s mail does not roll back completion or rerun execution",
  async (state) => {
    const h = harness(1);
    h.notify.mockResolvedValue({ state, explanation: "Notification unavailable" });
    await h.begin();
    await h.complete();
    await h.coordinator.reconcile("fallback");
    expect(h.state.assignment.status).toBe("done");
    expect(h.turns).toHaveLength(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.diagnostics).toHaveBeenCalled();
  },
);
