import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Format } from "typebox/format";
import { Value } from "typebox/value";
import abilityCatalog from "../supabase/functions/assignments/abilities.json" with { type: "json" };

Format.Set("date-time", Format.IsDateTime);
const text = Type.String({ minLength: 1, pattern: "\\S" });
const id = Type.String({ pattern: "^[0-9a-f]{8}$" });
const time = Type.String({ format: "date-time" });
const SavedBindingSchema = Type.Object(
  {
    project: text,
    assignment_id: id,
    claimed_at: time,
    claimed_by: Type.Optional(Type.Union([text, Type.Null()])),
    session_file: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export function parseBinding(value: unknown, sessionFile: string) {
  const saved = parseValue(SavedBindingSchema, value);
  return { ...saved, claimed_by: saved.claimed_by ?? null, session_file: sessionFile };
}
/** The latest assignment binding recorded in the session, or undefined when it is not bound. */
export function currentBinding(ctx: Pick<ExtensionContext, "sessionManager">) {
  const entry = [...ctx.sessionManager.getEntries()]
    .reverse()
    .find((entry) => entry.type === "custom" && entry.customType === "assignment-binding");
  return entry?.type === "custom"
    ? parseBinding(entry.data, ctx.sessionManager.getSessionFile() ?? "")
    : undefined;
}
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
    claimed_by: Type.Union([text, Type.Null()]),
    require_abilities: Type.Array(text),
    difficulty: Type.Union([
      Type.Literal("easy"),
      Type.Literal("medium"),
      Type.Literal("hard"),
      Type.Literal("hail_mary"),
    ]),
    lease_expired_at: Type.Union([time, Type.Null()]),
    lease_expired: Type.Boolean(),
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
    code: Type.Literal("unknown_abilities"),
    unknown: Type.Array(Type.String()),
    suggestions: Type.Record(Type.String(), Type.Array(Type.String())),
  }),
  Type.Object({
    ...refused,
    code: Type.Literal("ability_mismatch"),
    assignment: AssignmentSchema,
    missing: Type.Array(text),
  }),
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
// Model-facing parameters for report_execution_result. Flat on purpose: the Claude
// bridge (pi-claude-directsdk) strips top-level anyOf/oneOf/allOf and would send the
// model an empty schema. The union above is still enforced by parseExecutionResult.
const nonBlank = { minLength: 1, pattern: "\\S" } as const;
export const ExecutionResultParameters = Type.Object(
  {
    outcome: Type.Unsafe<"completed" | "blocked">({
      type: "string",
      enum: ["completed", "blocked"],
      description:
        'Use "completed" only when the TODO goal is done and verified. Use "blocked" when it cannot be finished; then also send blocker.',
    }),
    summary: Type.String({
      ...nonBlank,
      description: "What was done, or what stopped the TODO. One or two sentences.",
    }),
    evidence: Type.Array(Type.String(nonBlank), {
      description:
        "Concrete proof for the outcome: commands run, paths, URLs or output. Use [] when there is none.",
    }),
    blocker: Type.Optional(
      Type.String({
        ...nonBlank,
        description:
          'Required when outcome is "blocked": the specific missing input, decision or access. Omit when outcome is "completed".',
      }),
    ),
  },
  { additionalProperties: false },
);
const CapabilityConfigurationSchema = Type.Object(
  {
    abilities: Type.Array(Type.String(), {
      description: `Specialist names: ${Object.keys(abilityCatalog).join(", ") || "none; use [] for general work"}. Exact matches only.`,
    }),
  },
  { additionalProperties: false },
);
export function parseAbilities(values: unknown): Set<string> {
  const { abilities } = parseValue(CapabilityConfigurationSchema, { abilities: values });
  const unknown = abilities.filter((name) => !Object.hasOwn(abilityCatalog, name));
  if (unknown.length)
    throw new Error(
      "Unknown configured specialist abilities in BATTUTA_WORKER_CAPABILITIES. Use exact names from the specialist catalog.",
    );
  return new Set(abilities);
}
export function parseValue<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new Error("Invalid assignment value");
  return value;
}
const reportFields = new Set(["outcome", "summary", "evidence", "blocker"]);
const blank = (value: unknown) => typeof value !== "string" || !/\S/.test(value);
// Field-specific wording so the model knows exactly what to resend.
function reportProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "Report must be an object with outcome, summary, evidence and, when blocked, blocker.";
  const fields = value as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => !reportFields.has(key));
  if (extra !== undefined)
    return `Unknown report field "${extra}". Send only outcome, summary, evidence and, when blocked, blocker.`;
  if (fields.outcome === undefined) return 'outcome is required: send "completed" or "blocked".';
  if (fields.outcome !== "completed" && fields.outcome !== "blocked")
    return `outcome must be "completed" or "blocked"; got ${JSON.stringify(fields.outcome)}.`;
  if (blank(fields.summary))
    return "summary is required: send a non-empty string saying what was done, or what stopped the TODO.";
  if (!Array.isArray(fields.evidence) || fields.evidence.some((item: unknown) => blank(item)))
    return "evidence is required: send an array of non-empty strings, or [] when there is none.";
  if (fields.outcome === "blocked") {
    if (blank(fields.blocker))
      return 'blocker is required when outcome is "blocked": send a non-empty string naming the missing input, decision or access.';
  } else if ("blocker" in fields)
    return 'blocker is only allowed when outcome is "blocked": remove blocker from this completed report.';
  return undefined;
}
export function parseExecutionResult(value: unknown): ExecutionResult {
  const problem = reportProblem(value);
  if (problem) throw new Error(problem);
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
