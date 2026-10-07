// Runtime-neutral contracts: no package, Node, or Deno imports.
export interface Reference {
  locator: string;
  description: string;
}
export interface TaskInstruction {
  schema_version: 1;
  summary: string;
  objective: string;
  scope: string[];
  constraints: string[];
  inputs: Reference[];
  acceptance_criteria: { id: string; expectation: string }[];
  deliverables: string[];
}
export interface DelegateInput {
  key: string;
  project: string;
  ticket_id?: string;
  instruction: TaskInstruction;
}
export interface TerminalReport {
  schema_version: 1;
  state: "completed" | "failed";
  summary: string;
  checks: {
    criterion_id: string;
    result: "passed" | "failed" | "not_verified";
    evidence: Reference[];
  }[];
  artifacts: Reference[];
  failure: string | null;
}
export interface TaskRow {
  id: string;
  key: string;
  project: string;
  ticket_id: string | null;
  delegator_role: "pm" | "tl";
  instruction: TaskInstruction;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  opencode_session_id: string | null;
  terminal_report: TerminalReport | null;
  finished_at: string | null;
  result_message_ref: { conversation_id: string; id: string } | null;
}
export interface WorkerResult {
  schema_version: 1;
  kind: "worker_result";
  state: "completed" | "failed";
  text: string;
  references: { locator: string; note: string }[];
}
export type Principal =
  | { role: "pm" | "tl"; projects: string[]; worker_id?: never }
  | { role: "worker"; projects: string[]; worker_id: string };

interface Schema {
  type?: "object" | "array" | "string" | "null" | "integer";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: (string | number)[];
  anyOf?: Schema[];
}
const text = (maxLength = 4000, pattern = "\\S"): Schema => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern,
});
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: false,
});
const list = (items: Schema, minItems = 0): Schema => ({
  type: "array",
  items,
  minItems,
  maxItems: 30,
});
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const version: Schema = { type: "integer", enum: [1] };
const address: Schema = { type: "string", minLength: 1, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" };
const criterionId = text(64, "^[A-Za-z0-9][A-Za-z0-9._-]*$");
const identifier = (limit: number): Schema =>
  text(limit, "^(?!.*(?:[\\\\/]|\\.\\.|[\\u0000-\\u001f\\u007f-\\u009f]))(?!\\.$).*\\S.*$");
const uuid = text(
  36,
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
);
const timestamp = text(
  64,
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
);
const reference = object({ locator: text(2000), description: text() });
const instructionSchema = object({
  schema_version: version,
  summary: text(2000),
  objective: text(),
  scope: list(text(), 1),
  constraints: list(text()),
  inputs: list(reference),
  acceptance_criteria: list(object({ id: criterionId, expectation: text() }), 1),
  deliverables: list(text(), 1),
});
export const DelegateInputSchema = object(
  {
    key: text(256),
    project: identifier(128),
    ticket_id: identifier(64),
    instruction: instructionSchema,
  },
  ["ticket_id"],
);
const reportSchema = object({
  schema_version: version,
  state: { type: "string", enum: ["completed", "failed"] },
  summary: text(2000),
  checks: list(
    object({
      criterion_id: criterionId,
      result: { type: "string", enum: ["passed", "failed", "not_verified"] },
      evidence: list(reference),
    }),
  ),
  artifacts: list(reference),
  failure: nullable(text()),
});
const rowSchema = object({
  id: uuid,
  key: text(256),
  project: identifier(128),
  ticket_id: nullable(identifier(64)),
  delegator_role: { type: "string", enum: ["pm", "tl"] },
  instruction: instructionSchema,
  created_at: timestamp,
  claimed_by: nullable(address),
  claimed_at: nullable(timestamp),
  opencode_session_id: nullable(text(256)),
  terminal_report: nullable(reportSchema),
  finished_at: nullable(timestamp),
  result_message_ref: nullable(object({ conversation_id: uuid, id: text(12, "^[a-f0-9]{12}$") })),
});
function invalid(): never {
  throw new Error("Invalid task contract");
}
function matches(schema: Schema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((item) => matches(item, value));
  if (schema.enum && !schema.enum.includes(value as string | number)) return false;
  switch (schema.type) {
    case "null":
      return value === null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return (
        typeof value === "string" &&
        [...value].length >= (schema.minLength ?? 0) &&
        [...value].length <= (schema.maxLength ?? Infinity) &&
        (!schema.pattern || new RegExp(schema.pattern).test(value))
      );
    case "array":
      return (
        Array.isArray(value) &&
        value.length >= (schema.minItems ?? 0) &&
        value.length <= (schema.maxItems ?? Infinity) &&
        Array.from(value).every((item: unknown) => matches(schema.items!, item))
      );
    case "object": {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype
      )
        return false;
      const record = value as Record<string, unknown>;
      return (
        schema.required!.every((key) => Object.hasOwn(record, key)) &&
        Object.keys(record).every(
          (key) =>
            Object.hasOwn(schema.properties!, key) && matches(schema.properties![key], record[key]),
        )
      );
    }
    default:
      return false;
  }
}
function bounded(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) invalid();
}
function validateInstruction(input: unknown): TaskInstruction {
  if (!matches(instructionSchema, input)) invalid();
  bounded(input);
  const instruction = input as TaskInstruction;
  const ids = instruction.acceptance_criteria.map((criterion) => criterion.id);
  if (new Set(ids).size !== ids.length) invalid();
  return instruction;
}
export function validateDelegate(input: unknown): DelegateInput {
  if (!matches(DelegateInputSchema, input)) invalid();
  const delegation = input as DelegateInput;
  validateInstruction(delegation.instruction);
  return delegation;
}
export function validateReport(input: unknown, instruction: TaskInstruction): TerminalReport {
  validateInstruction(instruction);
  if (!matches(reportSchema, input)) invalid();
  bounded(input);
  const report = input as TerminalReport;
  const allowed = new Set(instruction.acceptance_criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  for (const check of report.checks) {
    if (!allowed.has(check.criterion_id) || seen.has(check.criterion_id)) invalid();
    seen.add(check.criterion_id);
    if (report.state === "completed" && (check.result !== "passed" || check.evidence.length === 0))
      invalid();
  }
  if (
    report.state === "completed"
      ? seen.size !== allowed.size || report.failure !== null
      : report.failure === null
  )
    invalid();
  return report;
}
export function validateTaskRow(input: unknown): TaskRow {
  if (!matches(rowSchema, input)) invalid();
  const task = input as TaskRow;
  validateInstruction(task.instruction);
  for (const time of [task.created_at, task.claimed_at, task.finished_at])
    if (time !== null && !Number.isFinite(Date.parse(time))) invalid();
  const owned = task.claimed_by !== null;
  const finished = task.terminal_report !== null;
  if (
    owned !== (task.claimed_at !== null) ||
    (!owned && (task.opencode_session_id !== null || finished)) ||
    finished !== (task.finished_at !== null) ||
    finished !== (task.result_message_ref !== null)
  )
    invalid();
  if (finished) validateReport(task.terminal_report, task.instruction);
  return task;
}
// Accept only the battuta object from verified app_metadata; this is not authentication.
export function validatePrincipal(metadata: unknown): Principal {
  const schema = object(
    {
      role: { type: "string", enum: ["pm", "tl", "worker"] },
      projects: { type: "array", items: identifier(128) },
      worker_id: address,
    },
    ["worker_id"],
  );
  if (!matches(schema, metadata)) invalid();
  const principal = metadata as Principal;
  if (
    principal.role === "worker"
      ? !Object.hasOwn(principal, "worker_id")
      : Object.hasOwn(principal, "worker_id")
  )
    invalid();
  return principal;
}
export function deriveState(task: TaskRow): "queued" | "running" | "completed" | "failed" {
  return task.terminal_report?.state ?? (task.claimed_by === null ? "queued" : "running");
}
export function initialPromptId(taskId: string): string {
  if (!matches(uuid, taskId)) invalid();
  return `msg_battuta_${taskId.replaceAll("-", "")}`;
}
export function formatWorkerResult(task: TaskRow, report: TerminalReport): WorkerResult {
  validateReport(report, task.instruction);
  return {
    schema_version: 1,
    kind: "worker_result",
    state: report.state,
    text: `${task.project} — ${task.instruction.summary}\n${report.summary}${report.failure === null ? "" : `\n${report.failure}`}`,
    references: report.artifacts.map((artifact) => ({
      locator: artifact.locator,
      note: artifact.description,
    })),
  };
}
