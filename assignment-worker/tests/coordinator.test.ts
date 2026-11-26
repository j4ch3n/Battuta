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
import { detail, settings } from "./fixtures.ts";

const conversationId = "22222222-2222-4222-8222-222222222222";

function harness(count = 2) {
  const runs = { active: false, stop: vi.fn(() => ((runs.active = false), Promise.resolve())) };
  const asks = { waiting: false, cancel: vi.fn(() => (asks.waiting = false)) };
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
      state.assignment.claimed_by = "test-worker";
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
    renew: vi.fn(() => Promise.resolve({ ok: true as const, assignment: clone(state.assignment) })),
    settings: vi.fn(() => Promise.resolve(settings())),
    close: vi.fn(() => Promise.resolve()),
  } satisfies AssignmentClient;
  const sessions = {
    prepareWorkspace: vi.fn(() =>
      Promise.resolve({
        directory: "/private/assignment",
        notePath: "/private/assignment/note.md",
      }),
    ),
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    openAssignmentSession: vi.fn((d: Detail) => {
      const binding = {
        project: d.assignment.project,
        assignment_id: d.assignment.id,
        claimed_at: d.assignment.claimed_at!,
        claimed_by: d.assignment.claimed_by,
        session_file: "/private/test-session.jsonl",
      };
      opened.push(binding);
      return Promise.resolve(binding);
    }),
    runTodo: vi.fn((binding: Binding, todo: { position: number }) => {
      turns.push({ binding, position: todo.position });
      return Promise.resolve();
    }),
    remind: vi.fn(),
    abort: vi.fn(),
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
  const coordinator = createCoordinator({
    assignments,
    sessions,
    diagnostics,
    notify,
    workerId: "test-worker",
    capabilities: [],
    conversationId,
    settings: settings(),
    runs: { isRunActive: () => runs.active, stop: runs.stop },
    asks,
  });
  const bound: Binding[] = [];
  const unbound: Binding[] = [];
  coordinator.on("bound", (b) => bound.push(b));
  coordinator.on("unbound", (b) => unbound.push(b));
  return {
    state,
    runs,
    asks,
    bound,
    unbound,
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
    },
  };
}

test("configured general workers claim without a model bootstrap", async () => {
  const h = harness(1);
  await h.coordinator.reconcile("startup");
  expect(h.assignments.claim).toHaveBeenCalledWith({
    project: "atlas",
    assignment_id: "1234abcd",
    claimed_by: "test-worker",
    abilities: [],
    conversation_id: conversationId,
  });
});

test("all required abilities must match locally before attempting a claim", async () => {
  const h = harness();
  h.state.assignment.require_abilities = ["mobile_use"];
  await h.coordinator.reconcile("idle");
  expect(h.assignments.claim).not.toHaveBeenCalled();
});

test("stale claimant rows never dispatch", async () => {
  const h = harness();
  await h.coordinator.reconcile("idle");
  h.state.assignment.claimed_by = "another-worker";
  await h.coordinator.restoreBinding(h.opened[0]);
  expect(h.turns).toEqual([]);
});

test("restored claims lacking configured specialists block before execution", async () => {
  const h = harness();
  await h.coordinator.reconcile("idle");
  h.state.assignment.require_abilities = ["mobile_use"];
  await h.coordinator.restoreBinding(h.opened[0]);
  expect(h.state.assignment.status).toBe("blocked");
  expect(h.turns).toEqual([]);
  expect(h.notifications).toHaveLength(1);
});

test("workspace is prepared once after claiming, before any TODO starts", async () => {
  const h = harness();
  h.sessions.prepareWorkspace.mockImplementation(() => {
    expect(h.state.assignment.status).toBe("in_process");
    expect(h.state.assignment.claimed_by).toBe("test-worker");
    expect(h.assignments.start).not.toHaveBeenCalled();
    return Promise.resolve({
      directory: "/private/assignment",
      notePath: "/private/assignment/note.md",
    });
  });
  await h.begin();
  expect(h.sessions.prepareWorkspace).toHaveBeenCalledTimes(1);
  expect(h.turns).toHaveLength(1);
  await h.complete();
  expect(h.turns).toHaveLength(2);
  expect(h.sessions.prepareWorkspace).toHaveBeenCalledTimes(1);
});
test.each(["claim", "restore"])(
  "workspace failure during %s blocks honestly without model execution",
  async (stage) => {
    const h = harness();
    if (stage === "restore") await h.coordinator.reconcile("idle");
    h.sessions.prepareWorkspace.mockRejectedValueOnce(new Error("permission denied"));
    if (stage === "restore") {
      const restored = createCoordinator({
        assignments: h.assignments,
        sessions: h.sessions,
        notify: h.notify,
        diagnostics: h.diagnostics,
        workerId: "restored-worker",
        capabilities: [],
        conversationId,
        settings: settings(),
      });
      await restored.restoreBinding(h.opened[0]);
    } else await h.coordinator.reconcile("idle");
    expect(h.assignments.start).not.toHaveBeenCalled();
    expect(h.turns).toEqual([]);
    expect(h.state.assignment.status).toBe("blocked");
    expect(h.state.assignment.claimed_by).toBe("test-worker");
    expect(h.notifications).toHaveLength(1);
  },
);
test("an unconfirmed workspace blocker releases the claim to lapse without opening a session", async () => {
  const h = harness();
  h.sessions.prepareWorkspace.mockRejectedValueOnce(new Error("denied"));
  h.assignments.block.mockRejectedValue(new UncertainAssignmentWriteError("block_assignment"));
  await h.coordinator.reconcile("idle");
  expect(h.state.assignment.status).toBe("in_process");
  expect(h.sessions.openAssignmentSession).not.toHaveBeenCalled();
  expect(h.notifications).toEqual([]);
  expect(h.unbound).toHaveLength(1);
});
test("cancellation during preparation prevents handoff and execution", async () => {
  const h = harness();
  h.sessions.prepareWorkspace.mockImplementation(() => {
    h.state.assignment.status = "cancelled";
    return Promise.resolve({
      directory: "/private/assignment",
      notePath: "/private/assignment/note.md",
    });
  });
  await h.coordinator.reconcile("idle");
  expect(h.sessions.openAssignmentSession).not.toHaveBeenCalled();
  expect(h.assignments.start).not.toHaveBeenCalled();
  expect(h.turns).toEqual([]);
});

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

test("blocked reports stop the assignment without rewriting future TODOs", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.acceptReport({
    outcome: "blocked",
    summary: "Investigated",
    evidence: [],
    blocker: "Missing authority",
  });
  expect(h.state.assignment.blocker).toBe("Missing authority");
  expect(h.state.todos.map((t) => t.status)).toEqual(["blocked", "todo"]);
  expect(h.notifications[0].todos[1].status).toBe("todo");
});

test("obsolete claims stop without completion mail or recovery claims", async () => {
  const h = harness();
  await h.begin();
  h.state.assignment.status = "cancelled";
  await h.coordinator.acceptReport({ outcome: "completed", summary: "Late", evidence: [] });
  await h.coordinator.reconcile("fallback");
  expect(h.state.assignment.status).toBe("cancelled");
  expect(h.notifications).toEqual([]);
  expect(h.opened).toHaveLength(1);
  expect(h.sessions.abort).toHaveBeenCalled();
  expect(h.unbound).toHaveLength(1);
});

test("an uncertain claim is never treated as owned", async () => {
  const h = harness();
  h.assignments.claim.mockRejectedValue(new UncertainAssignmentWriteError("Unknown"));
  await h.coordinator.reconcile("startup");
  expect(h.assignments.claim).toHaveBeenCalledTimes(1);
  expect(h.bound).toEqual([]);
  expect(h.opened).toEqual([]);
  expect(h.turns).toEqual([]);
  expect(h.diagnostics).toHaveBeenCalled();
});

test.each([true, false])(
  "uncertain result confirms exact persisted evidence or releases the claim (committed=%s)",
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

test("backend outage while blocking releases the claim to lapse and never fabricates remote status", async () => {
  const h = harness();
  await h.begin();
  h.assignments.block.mockRejectedValue(new Error("Offline"));
  await h.coordinator.agentFailed("Model provider unavailable: offline");
  await h.coordinator.reconcile("fallback");
  expect(h.state.assignment.status).toBe("in_process");
  expect(h.notifications).toEqual([]);
  expect(h.opened).toHaveLength(1);
  expect(h.unbound).toHaveLength(1);
});

test.each([true, false])(
  "uncertain blocker acknowledgement is inspected, never rewritten (committed=%s)",
  async (committed) => {
    const h = harness(1);
    await h.begin();
    const original = h.assignments.block.getMockImplementation()!;
    h.assignments.block.mockImplementation(async (input) => {
      if (committed) await original(input);
      throw new UncertainAssignmentWriteError("Lost blocker acknowledgement");
    });
    await h.coordinator.agentFailed("Model provider unavailable: offline");
    expect(h.notifications).toHaveLength(committed ? 1 : 0);
    expect(h.assignments.block).toHaveBeenCalledTimes(1);
    expect(h.state.assignment.status).toBe(committed ? "blocked" : "in_process");
  },
);

test("uncertain blocker does not report a different authoritative claim's outcome", async () => {
  const h = harness(1);
  await h.begin();
  h.assignments.block.mockImplementation(() => {
    h.state.assignment.claimed_at = "2026-11-04T13:00:00.000001Z";
    h.state.assignment.status = "blocked";
    h.state.assignment.blocker = "Execution ended with an unrecoverable error";
    return Promise.reject(new UncertainAssignmentWriteError("Old claim reply lost"));
  });
  await h.coordinator.agentFailed("Model provider unavailable: offline");
  expect(h.notifications).toEqual([]);
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

test("stop invalidates callbacks immediately and never releases a claim", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.stop();
  await h.coordinator.agentFailed("Execution was aborted before confirmed completion");
  await h.coordinator.agentIdle();
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

test("a failed conversation handoff blocks with its explanation and tells the Manager", async () => {
  const conversation = harness();
  conversation.sessions.openAssignmentSession.mockRejectedValue(
    new Error("Session initialization failed"),
  );
  await conversation.coordinator.reconcile("startup");
  expect(conversation.state.assignment.status).toBe("blocked");
  expect(conversation.notifications).toHaveLength(1);
  expect(conversation.turns).toEqual([]);
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

test("an agent error blocks with its explanation, stopping an active run first", async () => {
  const h = harness(1);
  await h.begin();
  h.runs.active = true;
  await h.coordinator.agentFailed("Model provider is out of credit: insufficient_quota");
  expect(h.runs.stop).toHaveBeenCalledTimes(1);
  expect(h.state.assignment.status).toBe("blocked");
  expect(h.state.assignment.blocker).toBe("Model provider is out of credit: insufficient_quota");
  expect(h.notifications).toHaveLength(1);
  expect(h.unbound).toHaveLength(1);
});

test("first TODO starts without any model selection step", async () => {
  const h = harness(1);
  await h.begin();
  expect(h.state.assignment.status).not.toBe("blocked");
  expect(h.turns).toHaveLength(1);
});

test.each([1, 3])("a %i-TODO run settles done when each TODO's report is valid", async (count) => {
  const h = harness(count);
  await h.begin();
  for (let position = 1; position <= count; position++) {
    expect(h.state.todos[position - 1].status).toBe("in_progress");
    await h.complete();
  }
  expect(h.state.todos.map((todo) => todo.status)).toEqual(Array(count).fill("done"));
  expect(h.state.assignment.status).toBe("done");
  expect(h.turns.map((turn) => turn.position)).toEqual(
    Array.from({ length: count }, (_, i) => i + 1),
  );
  expect(h.notifications.map((d) => d.assignment.status)).toEqual(["done"]);
});

test("an invalid flat report is rejected with a field-specific message and the run still settles after a valid retry", async () => {
  const h = harness(1);
  await h.begin();
  await expect(
    h.coordinator.acceptReport({ outcome: "blocked", summary: "Missing input", evidence: [] }),
  ).rejects.toThrow(/blocker is required when outcome is "blocked"/);
  await h.complete();
  expect(h.state.assignment.status).toBe("done");
  expect(h.notifications.map((d) => d.assignment.status)).toEqual(["done"]);
});

test("a completed report is recorded in the tool call and the next TODO dispatched", async () => {
  const h = harness(2);
  await h.begin();
  await h.complete();
  expect(h.assignments.record).toHaveBeenCalledTimes(1);
  expect(h.state.todos[0].status).toBe("done");
  expect(h.turns.map((t) => t.position)).toEqual([1, 2]);
});

test("a blocked report notifies and unbinds", async () => {
  const h = harness();
  await h.begin();
  await h.coordinator.acceptReport({
    outcome: "blocked",
    summary: "Stuck",
    evidence: [],
    blocker: "Missing token",
  });
  expect(h.notifications.map((d) => d.assignment.status)).toEqual(["blocked"]);
  expect(h.unbound).toHaveLength(1);
});

test("an idle agent without a report is reminded once, then blocked", async () => {
  const h = harness(1);
  await h.begin();
  await h.coordinator.agentIdle();
  expect(h.sessions.remind).toHaveBeenCalledTimes(1);
  expect(h.state.assignment.status).toBe("in_process");
  await h.coordinator.agentIdle();
  expect(h.state.assignment.status).toBe("blocked");
  expect(h.notifications).toHaveLength(1);
});

test("each TODO gets its own reminder", async () => {
  const h = harness(2);
  await h.begin();
  await h.coordinator.agentIdle();
  await h.complete();
  await h.coordinator.agentIdle();
  expect(h.sessions.remind).toHaveBeenCalledTimes(2);
  expect(h.state.assignment.status).toBe("in_process");
});

test.each(["a run active", "pending messages", "a waiting question", "no bound TODO"] as const)(
  "an idle agent with %s is left alone",
  async (condition) => {
    const h = harness(1);
    if (condition !== "no bound TODO") await h.begin();
    if (condition === "a run active") h.runs.active = true;
    if (condition === "pending messages") h.pending(true);
    if (condition === "a waiting question") h.asks.waiting = true;
    await h.coordinator.agentIdle();
    await h.coordinator.agentIdle();
    expect(h.sessions.remind).not.toHaveBeenCalled();
    expect(h.assignments.block).not.toHaveBeenCalled();
  },
);

test("a lost lease stops the run and the agent, cancels the question and unbinds", async () => {
  const h = harness(1);
  await h.begin();
  h.runs.active = true;
  h.asks.waiting = true;
  await h.coordinator.leaseLost("Lease renewal refused: Claim replaced");
  expect(h.runs.stop).toHaveBeenCalledTimes(1);
  expect(h.sessions.abort).toHaveBeenCalledTimes(1);
  expect(h.asks.cancel).toHaveBeenCalled();
  expect(h.unbound).toHaveLength(1);
  expect(h.entries.at(-1)?.kind).toBe("assignment-released");
  await expect(
    h.coordinator.acceptReport({ outcome: "completed", summary: "Late", evidence: [] }),
  ).rejects.toThrow();
  await vi.waitFor(() => expect(h.assignments.list).toHaveBeenCalledTimes(2));
});

test("a refused record releases the claim", async () => {
  const h = harness(1);
  await h.begin();
  h.state.assignment.claimed_at = "2026-11-04T13:00:00.000001Z";
  await h.complete();
  expect(h.unbound).toHaveLength(1);
  expect(h.notifications).toEqual([]);
});

test("claim and restore emit bound with the claim", async () => {
  const h = harness(1);
  await h.begin();
  expect(h.bound.map((b) => b.claimed_at)).toEqual([
    h.state.assignment.claimed_at,
    h.state.assignment.claimed_at,
  ]);
});

test("the last report during a tool call never opens a new session", async () => {
  const h = harness(1);
  await h.begin();
  h.busy(true);
  await h.complete();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.state.assignment.status).toBe("done");
  expect(h.sessions.openAssignmentSession).toHaveBeenCalledTimes(1);
});
