import { z } from "zod";
import { abilityProposal } from "./abilities.ts";

const text = z
  .string()
  .refine(
    (value) => /\S/u.test(value) && !value.includes("\0"),
    "Expected nonblank text without NUL",
  );
const project = text.refine(
  (value) => !value.startsWith(".") && !/[/\\\p{Cc}]/u.test(value),
  "Expected a registered project name",
);
const id = z.string().regex(/^[0-9a-f]{8}$/);
const timestamp = z.iso.datetime({ offset: true });
const assignmentStatus = z.enum(["active", "in_process", "blocked", "done", "cancelled"]);
const todoStatus = z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]);
const assignment = z.object({
  id,
  project,
  goal: text,
  constraints: z.string(),
  status: assignmentStatus,
  notes_path: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  closed_at: timestamp.nullable(),
  claimed_at: timestamp.nullable(),
  claim_by: text.nullable(),
  require_abilities: z.array(z.string()),
  lease_expired_at: timestamp.nullable(),
  blocker: text.nullable(),
  dependencies: z.array(z.object({ assignment_id: id, project, status: assignmentStatus })),
  ready: z.boolean(),
});
const todo = z.object({
  assignment_id: id,
  position: z.number().int().positive(),
  description: text,
  status: todoStatus,
  outcome: z.string(),
  evidence: z.array(text),
  blocker: text.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
const refused = z.object({ ok: z.literal(false), message: text });
const failure = z.discriminatedUnion("code", [
  refused.extend({
    code: z.literal("unknown_abilities"),
    unknown: z.array(z.string()),
    suggestions: z.record(z.string(), z.array(z.string())),
  }),
  refused.extend({ code: z.literal("ability_mismatch"), missing: z.array(z.string()), assignment }),
  refused.extend({
    code: z.literal("missing_dependencies"),
    missing_assignment_ids: z.array(id).min(1),
  }),
  refused.extend({
    code: z.literal("not_claimable"),
    assignment,
    reason: z.enum(["status", "claimed", "dependencies", "no_executable_todos", "todo_state"]),
  }),
  refused.extend({ code: z.literal("stale_claim"), assignment }),
  refused.extend({ code: z.literal("stale_update"), todo }),
  refused.extend({ code: z.literal("unfinished_todos"), unfinished: z.array(todo) }),
  refused.extend({ code: z.literal("assignment_closed"), assignment }),
  refused
    .extend({
      code: z.literal("invalid_transition"),
      assignment: assignment.optional(),
      todo: todo.optional(),
    })
    .refine(
      (value) => value.assignment !== undefined || value.todo !== undefined,
      "Expected current assignment or TODO",
    ),
  refused.extend({ code: z.literal("notes_unprepared"), assignment }),
  refused.extend({ code: z.literal("notes_path_conflict"), assignment }),
  refused.extend({ code: z.literal("id_exhausted") }),
  refused.extend({ code: z.literal("not_found") }),
  refused.extend({ code: z.literal("invalid_input") }),
  refused.extend({ code: z.literal("backend_error") }),
]);
const assigned = z.object({ ok: z.literal(true), assignment });
const detail = assigned.extend({ todos: z.array(todo) });
const progressed = assigned.extend({ todo });
const notes = z
  .object({
    ok: z.literal(true),
    assignment,
    notes_ref: z
      .string()
      .refine((value) => {
        const match = /^projects\/(.+)\/work\/[0-9a-f]{8}\/note[.]md$/.exec(value);
        return match !== null && project.safeParse(match[1]).success;
      }, "Expected a host-neutral assignment note reference")
      .nullable(),
    editable: z.boolean(),
    guidance: z.string().optional(),
  })
  .refine(
    (value) =>
      value.notes_ref === null ||
      value.notes_ref ===
        `projects/${value.assignment.project}/work/${value.assignment.id}/note.md`,
    "Note reference must identify this assignment",
  );
export type NotesResult = z.infer<typeof notes>;
const target = { project, assignment_id: id };
const claim = { ...target, claimed_at: timestamp, claim_by: text.nullable().default(null) };
const item = {
  ...claim,
  position: z.number().int().positive().max(2147483647),
  expected_updated_at: timestamp,
};
const report = { ...item, summary: text, evidence: z.array(text) };

export const toolContracts = {
  create_assignment: {
    input: z.strictObject({
      project,
      goal: text,
      constraints: z.string().optional(),
      initial_todos: z.array(text).min(1),
      depends_on_assignment_ids: z.array(id).optional(),
      require_abilities: abilityProposal.default([]),
    }),
    output: z.union([detail, failure]),
  },
  list_assignments: {
    input: z.strictObject({ project: project.optional(), status: assignmentStatus.optional() }),
    output: z.union([z.object({ ok: z.literal(true), assignments: z.array(assignment) }), failure]),
  },
  get_assignment: {
    input: z.strictObject(target),
    output: z.union([detail, failure]),
  },
  append_todos: {
    input: z.strictObject({ ...target, descriptions: z.array(text).min(1) }),
    output: z.union([z.object({ ok: z.literal(true), todos: z.array(todo) }), failure]),
  },
  update_todo: {
    input: z
      .strictObject({
        ...target,
        position: z.number().int().positive().max(2147483647),
        expected_updated_at: timestamp,
        description: text.optional(),
        status: z.literal("cancelled").optional(),
      })
      .refine(
        (value) => value.description !== undefined || value.status !== undefined,
        "Supply at least one item field",
      ),
    output: z.union([z.object({ ok: z.literal(true), todo }), failure]),
  },
  close_assignment: {
    input: z.strictObject({ ...target, status: z.literal("cancelled") }),
    output: z.union([assigned, failure]),
  },
  prepare_notes: {
    input: z.strictObject(target),
    output: z.union([notes, failure]),
  },
  locate_notes: { input: z.strictObject(target), output: z.union([notes, failure]) },
  claim_assignment: {
    input: z.strictObject({ ...target, claim_by: text, abilities: abilityProposal }),
    output: z.union([detail, failure]),
  },
  start_todo: { input: z.strictObject(item), output: z.union([progressed, failure]) },
  record_todo_result: {
    input: z.discriminatedUnion("outcome", [
      z.strictObject({ ...report, outcome: z.literal("completed") }),
      z.strictObject({ ...report, outcome: z.literal("blocked"), blocker: text }),
    ]),
    output: z.union([progressed, failure]),
  },
  block_assignment: {
    input: z.strictObject({ ...claim, blocker: text }),
    output: z.union([assigned, failure]),
  },
  finish_assignment: { input: z.strictObject(claim), output: z.union([assigned, failure]) },
  reactivate_assignment: { input: z.strictObject(target), output: z.union([detail, failure]) },
};
export type ToolName = keyof typeof toolContracts;
