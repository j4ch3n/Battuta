import { z } from "zod";

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
const assignmentStatus = z.enum(["active", "done", "cancelled"]);
const todoStatus = z.enum(["todo", "in_progress", "done", "cancelled"]);
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
});
const todo = z.object({
  assignment_id: id,
  position: z.number().int().positive(),
  description: text,
  status: todoStatus,
  outcome: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});
const failure = z.object({
  ok: z.literal(false),
  code: z.enum([
    "active_exists",
    "id_exhausted",
    "unfinished_todos",
    "stale_update",
    "not_found",
    "assignment_closed",
    "notes_unprepared",
    "notes_path_conflict",
    "invalid_input",
    "backend_error",
  ]),
  assignment: assignment.optional(),
  todo: todo.optional(),
  unfinished: z.array(todo).optional(),
  message: z.string().optional(),
});
const assigned = z.object({ ok: z.literal(true), assignment });
const notes = z.object({
  ok: z.literal(true),
  assignment,
  notes_path: z.string().nullable(),
  editable: z.boolean(),
  guidance: z.string().optional(),
});
export type NotesResult = z.infer<typeof notes>;
const target = { project, assignment_id: id };

export const toolContracts = {
  create_assignment: {
    input: z.strictObject({ project, goal: text, constraints: z.string().optional() }),
    output: z.union([assigned, failure]),
  },
  list_assignments: {
    input: z.strictObject({ project, status: assignmentStatus.optional() }),
    output: z.union([z.object({ ok: z.literal(true), assignments: z.array(assignment) }), failure]),
  },
  get_assignment: {
    input: z.strictObject(target),
    output: z.union([assigned.extend({ todos: z.array(todo) }), failure]),
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
        status: todoStatus.optional(),
        outcome: z
          .string()
          .refine((value) => !value.includes("\0"))
          .optional(),
      })
      .refine(
        (value) =>
          value.description !== undefined ||
          value.status !== undefined ||
          value.outcome !== undefined,
        "Supply at least one item field",
      ),
    output: z.union([z.object({ ok: z.literal(true), todo }), failure]),
  },
  close_assignment: {
    input: z.strictObject({ ...target, status: z.enum(["done", "cancelled"]) }),
    output: z.union([assigned, failure]),
  },
  prepare_notes: {
    input: z.strictObject({ ...target, root: text }),
    output: z.union([notes, failure]),
  },
  locate_notes: { input: z.strictObject(target), output: z.union([notes, failure]) },
};
export type ToolName = keyof typeof toolContracts;
