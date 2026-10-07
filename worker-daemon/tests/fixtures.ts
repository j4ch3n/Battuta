import type { TaskRow, TerminalReport } from "../../supabase/functions/_shared/task-contracts.ts";

export const task: TaskRow = {
  id: "12345678-1234-1234-1234-123456789abc",
  key: "example",
  project: "Demo Project",
  ticket_id: "FIS-40",
  delegator_role: "tl",
  instruction: {
    schema_version: 1,
    summary: "Build useful feature today",
    objective: "Implement a feature",
    scope: ["feature"],
    constraints: ["preserve user work"],
    inputs: [],
    acceptance_criteria: [{ id: "works", expectation: "Tests pass" }],
    deliverables: ["code"],
  },
  created_at: "2026-10-07T00:00:00Z",
  claimed_by: "worker-1",
  claimed_at: "2026-10-07T00:01:00Z",
  opencode_session_id: null,
  terminal_report: null,
  finished_at: null,
  result_message_ref: null,
};
export const report: TerminalReport = {
  schema_version: 1,
  state: "completed",
  summary: "Implemented",
  checks: [
    {
      criterion_id: "works",
      result: "passed",
      evidence: [{ locator: "tests", description: "Passed" }],
    },
  ],
  artifacts: [],
  failure: null,
};
