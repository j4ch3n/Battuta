---
name: todo
description: Use when commissioning project work, maintaining shared ordered TODOs, inspecting assignment progress, or recording delivery and cancellation outcomes.
---

# Shared assignments and TODOs

Use the `assignments` MCP service. CoS creates the commission; Manager develops
the detailed steps, updates their actual status, reports each delivery through
Agent Mail, and closes the assignment after final delivery. All bots share access.
Records do not grant execution, publication, or product-acceptance authority.

## Project and assignment identity

Ask the owner which project to use when none is provided; confirm it before
creation. Use `battuta-project list` to verify the exact registered project name.
Do not silently infer the project from current selection. Every assignment,
TODO, and note must belong to a project assignment; there is no general scope.

Keep the returned eight-character `assignment_id` and exact project name in
handoffs and subsequent calls. At most one assignment is active per project.
Inspect existing work before creating another; an active conflict is not
permission to cancel it. Use note-taking for shared findings and draft-writing
for longer documents; do not duplicate those bodies into TODO outcomes.

## MCP tools

All assignment-targeting calls require `project` and `assignment_id`.

| Tool | Additional inputs | Effect |
| --- | --- | --- |
| `create_assignment` | `project`, `goal`, optional `constraints` | Create the active commission; include authority, boundaries, acceptance and input references |
| `list_assignments` | `project`, optional `status`: `active`, `done`, `cancelled` | Discover current or historical assignments, newest first |
| `get_assignment` | None | Read details and all items in stored position order |
| `append_todos` | `descriptions`: nonempty array of nonblank strings | Append steps with consecutive immutable positions |
| `update_todo` | `position`, `expected_updated_at`, at least one of `description`, `status`, `outcome` | Update that item in place; omitted fields stay unchanged |
| `close_assignment` | `status`: `done` or `cancelled` | Finish after item checks, or cancel without rewriting item outcomes |

Creation/listing take project but no existing assignment ID. There is no role
argument. Item statuses are `todo`, `in_progress`, `done`, and `cancelled`.
Follow the planned sequence, but any item can be updated/completed by position
without first completing earlier items. Positions never shift: append or edit
in place, cancel unwanted work, and retain its explanation. No reorder or delete.

Example update (use the actual token returned by `get_assignment`):

```json
{
  "project": "atlas",
  "assignment_id": "a3f91c2e",
  "position": 2,
  "expected_updated_at": "2026-11-04T12:00:00.123456+00:00",
  "status": "done",
  "outcome": "Verified the export with the supplied fixture; evidence: returned report path."
}
```

Pass `expected_updated_at` unchanged; do not parse/reformat it through a clock or
Date object. Null is not an edit value; omit unchanged fields. Empty `outcome`
clears it, but descriptions cannot be blank. Keep outcomes truthful and concise,
including sources/verification or cancellation reasons where relevant.

## Closure and errors

`done` refuses while any item is `todo`/`in_progress` and returns the unfinished
positions/statuses in order. Report those honestly and resolve them before
claiming completion. An empty assignment may finish. Cancellation skips that
check and preserves unfinished item statuses/evidence. Neither state means owner
acceptance. Closed assignments cannot receive new/edited TODOs or be reopened.

On `stale_update`, inspect the returned current item and reconcile before retrying;
never overwrite with an old token. Wrong-project/not-found/closed requests fail
without falling back to another record. After a network error or uncertain write,
inspect the assignment before repeating creation/appending: a lost response does
not mean nothing was saved. Do not silently fall back to local TODO files.

Mail is not automatic. Manager reports each delivery to CoS through Agent Mail
with project/assignment identity, outcome/evidence and remaining work, then marks
the assignment done after final delivery. Notes and drafts freeze on closure.
