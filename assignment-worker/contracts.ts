import { Type, type Static, type TSchema } from "typebox";
import { Format } from "typebox/format";
import { Value } from "typebox/value";

Format.Set("date-time", Format.IsDateTime);
const text = Type.String({ minLength: 1, pattern: "\\S" });
const id = Type.String({ pattern: "^[0-9a-f]{8}$" });
const time = Type.String({ format: "date-time" });
const assignmentStatus = Type.Union([
  Type.Literal("active"),
  Type.Literal("in_process"),
  Type.Literal("blocked"),
  Type.Literal("done"),
  Type.Literal("cancelled"),
]);
const todoStatus = Type.Union([
  Type.Literal("todo"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("done"),
  Type.Literal("cancelled"),
]);
export const AssignmentSchema = Type.Object(
  {
    id,
    project: text,
    goal: text,
    constraints: Type.String(),
    status: assignmentStatus,
    notes_path: Type.Union([Type.String(), Type.Null()]),
    created_at: time,
    updated_at: time,
    closed_at: Type.Union([time, Type.Null()]),
    claimed_at: Type.Union([time, Type.Null()]),
    lease_expired_at: Type.Union([time, Type.Null()]),
    blocker: Type.Union([text, Type.Null()]),
    dependencies: Type.Array(
      Type.Object(
        { assignment_id: id, project: text, status: assignmentStatus },
        { additionalProperties: false },
      ),
    ),
    ready: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const TodoSchema = Type.Object(
  {
    assignment_id: id,
    position: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    description: text,
    status: todoStatus,
    outcome: Type.String(),
    evidence: Type.Array(text),
    blocker: Type.Union([text, Type.Null()]),
    created_at: time,
    updated_at: time,
  },
  { additionalProperties: false },
);
export const AssignedSchema = Type.Object(
  { ok: Type.Literal(true), assignment: AssignmentSchema },
  { additionalProperties: false },
);
export const DetailSchema = Type.Object(
  { ...AssignedSchema.properties, todos: Type.Array(TodoSchema) },
  { additionalProperties: false },
);
export const ProgressSchema = Type.Object(
  { ...AssignedSchema.properties, todo: TodoSchema },
  { additionalProperties: false },
);
export const ListSchema = Type.Object(
  { ok: Type.Literal(true), assignments: Type.Array(AssignmentSchema) },
  { additionalProperties: false },
);
const refused = { ok: Type.Literal(false), message: text };
export const FailureSchema = Type.Union([
  Type.Object({
    ...refused,
    code: Type.Literal("missing_dependencies"),
    missing_assignment_ids: Type.Array(id, { minItems: 1 }),
  }),
  Type.Object({
    ...refused,
    code: Type.Literal("not_claimable"),
    assignment: AssignmentSchema,
    reason: Type.Union([
      Type.Literal("status"),
      Type.Literal("claimed"),
      Type.Literal("dependencies"),
      Type.Literal("no_executable_todos"),
      Type.Literal("todo_state"),
    ]),
  }),
  Type.Object({ ...refused, code: Type.Literal("stale_claim"), assignment: AssignmentSchema }),
  Type.Object({ ...refused, code: Type.Literal("stale_update"), todo: TodoSchema }),
  Type.Object({
    ...refused,
    code: Type.Literal("unfinished_todos"),
    unfinished: Type.Array(TodoSchema),
  }),
  Type.Object({
    ...refused,
    code: Type.Literal("assignment_closed"),
    assignment: AssignmentSchema,
  }),
  Type.Object({
    ...refused,
    code: Type.Literal("invalid_transition"),
    assignment: Type.Optional(AssignmentSchema),
    todo: Type.Optional(TodoSchema),
  }),
  Type.Object({ ...refused, code: Type.Literal("notes_unprepared"), assignment: AssignmentSchema }),
  Type.Object({
    ...refused,
    code: Type.Literal("notes_path_conflict"),
    assignment: AssignmentSchema,
  }),
  Type.Object({ ...refused, code: Type.Literal("id_exhausted") }),
  Type.Object({ ...refused, code: Type.Literal("not_found") }),
  Type.Object({ ...refused, code: Type.Literal("invalid_input") }),
  Type.Object({ ...refused, code: Type.Literal("backend_error") }),
]);
const report = { summary: text, evidence: Type.Array(text) };
export const ExecutionResultSchema = Type.Union([
  Type.Object({ ...report, outcome: Type.Literal("completed") }, { additionalProperties: false }),
  Type.Object(
    { ...report, outcome: Type.Literal("blocked"), blocker: text },
    { additionalProperties: false },
  ),
]);
export type ExecutionResult = Static<typeof ExecutionResultSchema>;
export function parseValue<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new Error("Invalid assignment value");
  return value;
}
export function parseExecutionResult(value: unknown): ExecutionResult {
  const result = parseValue(ExecutionResultSchema, value);
  const values = [
    result.summary,
    ...result.evidence,
    ...(result.outcome === "blocked" ? [result.blocker] : []),
  ];
  if (values.some((text) => text.includes("\0")))
    throw new Error("Report text must not contain NUL");
  return result;
}
