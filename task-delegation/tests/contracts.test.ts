import { describe, expect, it } from "vitest";
import {
  DelegateInputSchema,
  deriveState,
  formatWorkerResult,
  initialPromptId,
  validateDelegate,
  validatePrincipal,
  validateReport,
  validateTaskRow,
} from "../../supabase/functions/_shared/task-contracts.ts";

export const instruction = {
  schema_version: 1 as const,
  summary: "Fix parser",
  objective: "Parse inputs safely",
  scope: ["Parser"],
  constraints: [],
  inputs: [],
  acceptance_criteria: [{ id: "parse.1", expectation: "Reject malformed inputs" }],
  deliverables: ["Tests"],
};
export const delegation = { key: "request-1", project: "Battuta project", instruction };
export const completed = {
  schema_version: 1 as const,
  state: "completed" as const,
  summary: "Parser fixed",
  checks: [
    {
      criterion_id: "parse.1",
      result: "passed" as const,
      evidence: [{ locator: "tests/parser.test.ts", description: "Tests pass" }],
    },
  ],
  artifacts: [],
  failure: null,
};
export const queued = {
  id: "12345678-1234-4234-8234-123456789abc",
  ...delegation,
  ticket_id: null,
  delegator_role: "pm" as const,
  created_at: "2026-10-07T00:00:00Z",
  claimed_by: null,
  claimed_at: null,
  opencode_session_id: null,
  terminal_report: null,
  finished_at: null,
  result_message_ref: null,
};
export const running = { ...queued, claimed_by: "host-1", claimed_at: queued.created_at };
export const finished = {
  ...running,
  terminal_report: completed,
  finished_at: queued.created_at,
  result_message_ref: { conversation_id: queued.id, id: "abcdef123456" },
};

describe("task contracts", () => {
  it("accepts the versioned delegation and publishes a closed JSON schema", () => {
    expect(validateDelegate(delegation)).toEqual(delegation);
    expect(DelegateInputSchema.additionalProperties).toBe(false);
  });
  it.each(["status", "attempt_id", "running", "role"])(
    "rejects unsupported delegation field %s",
    (field) => {
      expect(() => validateDelegate({ ...delegation, [field]: "x" })).toThrow();
    },
  );
  it.each(["../repo", "a/b", "a\\b", ".", "..", "bad\nproject"])(
    "rejects unsafe project %j",
    (project) => {
      expect(() => validateDelegate({ ...delegation, project })).toThrow();
      expect(() => validateDelegate({ ...delegation, ticket_id: project })).toThrow();
    },
  );
  it.each([
    { summary: " " },
    { objective: "x".repeat(4001) },
    { summary: "x".repeat(2001) },
    { scope: [] },
    { deliverables: [] },
    { acceptance_criteria: [] },
    { scope: Array<string>(31).fill("x") },
    { inputs: [{ locator: "x".repeat(2001), description: "x" }] },
    { acceptance_criteria: [{ id: "bad id", expectation: "x" }] },
    { acceptance_criteria: [{ id: "x".repeat(65), expectation: "x" }] },
    {
      acceptance_criteria: [instruction.acceptance_criteria[0], instruction.acceptance_criteria[0]],
    },
    { inputs: [{ locator: "a", description: "b", extra: 1 }] },
    { extra: true },
  ])("rejects malformed instruction %j", (change) => {
    expect(() =>
      validateDelegate({ ...delegation, instruction: { ...instruction, ...change } }),
    ).toThrow();
  });
  it("enforces exact UTF-8 instruction payload boundaries", () => {
    const value = { ...instruction, constraints: Array<string>(17).fill("é".repeat(1810)) };
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    value.constraints.push("x".repeat(65536 - bytes - 3));
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBe(65536);
    expect(validateDelegate({ ...delegation, instruction: value }).instruction).toEqual(value);
    value.constraints[17] += "x";
    expect(() => validateDelegate({ ...delegation, instruction: value })).toThrow();
  });
  it("accepts maximum text, ID, and list sizes", () => {
    expect(
      validateDelegate({
        key: "x".repeat(256),
        project: "p".repeat(128),
        ticket_id: "t".repeat(64),
        instruction: {
          ...instruction,
          summary: "x".repeat(2000),
          objective: "x".repeat(4000),
          inputs: [{ locator: "x".repeat(2000), description: "x".repeat(4000) }],
          scope: Array<string>(30).fill("x"),
          acceptance_criteria: [{ id: "x".repeat(64), expectation: "x" }],
        },
      }),
    ).toBeDefined();
  });
  it.each(
    [
      [],
      [completed.checks[0], completed.checks[0]],
      [{ ...completed.checks[0], criterion_id: "unknown" }],
      [{ ...completed.checks[0], result: "failed" }],
      [{ ...completed.checks[0], evidence: [] }],
    ].map((checks) => ({ checks })),
  )("rejects invalid completion checks %j", ({ checks }) => {
    expect(() => validateReport({ ...completed, checks }, instruction)).toThrow();
  });
  it("accepts honest partial failures but rejects duplicate/unknown checks and unknown fields", () => {
    const failure = { ...completed, state: "failed", checks: [], failure: "Preparation failed" };
    expect(validateReport(failure, instruction)).toEqual(failure);
    for (const change of [
      { failure: " " },
      { extra: 1 },
      { checks: [completed.checks[0], completed.checks[0]] },
      { checks: [{ ...completed.checks[0], criterion_id: "unknown" }] },
    ]) {
      expect(() => validateReport({ ...failure, ...change }, instruction)).toThrow();
    }
    expect(() => validateReport({ ...completed, failure: "Unresolved" }, instruction)).toThrow();
  });
  it("deriveState_uses_nullable_columns including failed pre-session task", () => {
    expect(deriveState(validateTaskRow(queued))).toBe("queued");
    expect(deriveState(validateTaskRow(running))).toBe("running");
    expect(deriveState(validateTaskRow(finished))).toBe("completed");
    expect(
      deriveState(
        validateTaskRow({
          ...finished,
          terminal_report: { ...completed, state: "failed", checks: [], failure: "Git failed" },
        }),
      ),
    ).toBe("failed");
  });
  it.each([
    { claimed_at: queued.created_at },
    { opencode_session_id: "session-1" },
    { terminal_report: completed },
    { status: "queued" },
    { ticket_id: undefined },
    { id: "not-uuid" },
    { created_at: "yesterday" },
    { created_at: "2026-99-99T00:00:00Z" },
  ])("rejects row invariant violations %j", (change) => {
    expect(() => validateTaskRow({ ...queued, ...change })).toThrow();
  });
  it("validates principal metadata without granting caller authentication", () => {
    expect(
      validatePrincipal({ role: "worker", projects: ["Battuta project"], worker_id: "host.1" }),
    ).toEqual({ role: "worker", projects: ["Battuta project"], worker_id: "host.1" });
    expect(validatePrincipal({ role: "tl", projects: [] })).toEqual({ role: "tl", projects: [] });
    for (const value of [
      { role: "pm", projects: [], worker_id: "host" },
      { role: "worker", projects: [] },
      { role: "worker", projects: [], worker_id: "bad/id" },
      { role: "admin", projects: [] },
      { role: "pm", projects: ["../repo"] },
      { role: "pm", projects: [], extra: 1 },
    ])
      expect(() => validatePrincipal(value)).toThrow();
  });
  it("does not invent instruction-size caps on authenticated worker addresses or project grants", () => {
    const principal = {
      role: "worker",
      projects: Array<string>(31).fill("Battuta"),
      worker_id: "w".repeat(257),
    };
    expect(validatePrincipal(principal)).toEqual(principal);
  });
  it("derives stable prompt IDs and receive-only results without execution correlation", () => {
    expect(initialPromptId(queued.id)).toBe("msg_battuta_12345678123442348234123456789abc");
    expect(() => initialPromptId("oops")).toThrow();
    const result = formatWorkerResult(validateTaskRow(finished), completed);
    expect(result).toEqual({
      schema_version: 1,
      kind: "worker_result",
      state: "completed",
      text: "Battuta project — Fix parser\nParser fixed",
      references: [],
    });
    expect(JSON.stringify(result)).not.toContain(queued.id);
  });
  it.each([
    null,
    [],
    1,
    "text",
    { ...delegation, key: "x".repeat(257) },
    { ...delegation, project: "x".repeat(129) },
    { ...delegation, ticket_id: "x".repeat(65) },
  ])("rejects malformed delegation boundary %j", (input) => {
    expect(() => validateDelegate(input)).toThrow();
  });
  it("checks nested report shapes and produces readable failed results with artifact references", () => {
    const failure = {
      ...completed,
      state: "failed" as const,
      checks: [{ ...completed.checks[0], result: "not_verified" as const, evidence: [] }],
      failure: "Build blocked",
      artifacts: [{ locator: "build.log", description: "Compiler output" }],
    };
    expect(validateReport(failure, instruction)).toEqual(failure);
    expect(formatWorkerResult(validateTaskRow(running), failure)).toEqual({
      schema_version: 1,
      kind: "worker_result",
      state: "failed",
      text: "Battuta project — Fix parser\nParser fixed\nBuild blocked",
      references: [{ locator: "build.log", note: "Compiler output" }],
    });
    for (const change of [
      { schema_version: 2 },
      { state: "running" },
      { checks: [{ ...completed.checks[0], evidence: [{ locator: "x", description: " " }] }] },
      { artifacts: [{ locator: "x", description: "x", extra: true }] },
      { failure: null },
    ])
      expect(() => validateReport({ ...failure, ...change }, instruction)).toThrow();
  });
  it("rejects inconsistent owned/final rows and validates bound sessions", () => {
    expect(
      validateTaskRow({ ...running, opencode_session_id: "session-1" }).opencode_session_id,
    ).toBe("session-1");
    for (const change of [
      { finished_at: null },
      { result_message_ref: null },
      { claimed_by: null },
      { result_message_ref: { conversation_id: queued.id, id: "bad" } },
    ])
      expect(() => validateTaskRow({ ...finished, ...change })).toThrow();
  });
  it("rejects sparse arrays rather than serializing missing content as null", () => {
    expect(() =>
      validateDelegate({ ...delegation, instruction: { ...instruction, scope: Array<string>(1) } }),
    ).toThrow();
    expect(() =>
      validateReport({ ...completed, artifacts: Array<unknown>(1) }, instruction),
    ).toThrow();
  });
  it("bounds report UTF-8 payloads independently of per-reference text limits", () => {
    const report = {
      ...completed,
      state: "failed" as const,
      checks: [],
      failure: "Blocked",
      artifacts: Array.from({ length: 18 }, () => ({
        locator: "log",
        description: "é".repeat(1810),
      })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
    report.artifacts[17].description = "x".repeat(65536 - bytes + 3620);
    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBe(65536);
    expect(validateReport(report, instruction)).toEqual(report);
    report.artifacts[17].description += "x";
    expect(() => validateReport(report, instruction)).toThrow();
  });
});
