import type { Detail, LifecycleSettings } from "../types.ts";
export function detail(): Detail {
  return {
    ok: true,
    assignment: {
      id: "1234abcd",
      project: "atlas",
      goal: "Implement",
      constraints: "No publishing",
      status: "active",
      notes_path: null,
      created_at: "2026-11-04T12:00:00.000001Z",
      updated_at: "2026-11-04T12:00:00.000001Z",
      closed_at: null,
      claimed_at: null,
      claimed_by: null,
      require_abilities: [],
      difficulty: "easy",
      lease_expired_at: null,
      lease_expired: false,
      blocker: null,
      dependencies: [],
      ready: true,
    },
    todos: [
      {
        assignment_id: "1234abcd",
        position: 1,
        description: "Verify",
        status: "todo",
        outcome: "",
        evidence: [],
        blocker: null,
        created_at: "2026-11-04T12:00:00.000001Z",
        updated_at: "2026-11-04T12:00:00.000001Z",
      },
    ],
  };
}

/** Stored lifecycle settings as the database returns them: durations in seconds. */
export function settings(): LifecycleSettings {
  const message = (name: string) => ({ objective: `${name} {position}`, body: `${name} body` });
  return {
    lease: { duration: 600 },
    heartbeat: { interval: 60 },
    expiry: { check_interval: 60 },
    progress: { report_after: 600 },
    ask: { chase_after: 1800 },
    roles: { manager: "manager" },
    messages: {
      expiry_blocker: message("expiry_blocker"),
      manager_expiry_notice: message("manager_expiry_notice"),
      progress_request: message("progress_request"),
      idle_reminder: message("idle_reminder"),
      no_report_blocker: message("no_report_blocker"),
      ask_chase: message("ask_chase"),
    },
  };
}
