import type { Detail } from "../types.ts";
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
