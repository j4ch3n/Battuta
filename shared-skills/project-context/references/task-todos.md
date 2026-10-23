# Task-local execution todos

Both PM and TL use the `task_todos` model tool. An owner can ask in ordinary
Telegram conversation: “Show the steps for the import assessment”, “What is
blocked?”, or “Resume the assessment”. The bot reads the tool and replies with
the list, not a TUI screenshot or shell command.

## Invocation

1. Confirm the selected project with `battuta-project current`; switch to the
   intended project if needed. Todo calls use the selection at call time.
2. Call `task_todos({action: "tasks"})` to discover existing task keys on this
   bot/project/session branch. Choose a short stable key for a new request, or
   reuse the existing key when returning to it.
3. Read `task_todos({action: "list", task: "import-assessment"})`. A new list has
   revision 0. Every successful mutation returns the new revision and full list.
4. Add a bounded next step:
   `task_todos({action: "add", task: "import-assessment", revision: 0, text: "Compare supported import formats"})`.
5. Update by stable item ID, using the latest revision:
   `task_todos({action: "update", task: "import-assessment", revision: 1, id: 1, status: "in-progress"})`.

`update` accepts `text` and/or `status`. States are `pending`, `in-progress`,
`blocked`, `completed`, and `cancelled`; cancellation is not completion.
For `blocked`, provide both `reason` and `nextAction`. For `completed`, provide
both `outcome` and `verification` (an actual relevant check result or artifact/source
reference). Previous blocker and evidence fields are retained when status changes.
Evidence is recorded, not independently validated by the tool: never invent it.

On a revision conflict, list again and reconcile rather than retrying stale writes.
Unknown IDs and invalid updates leave the list unchanged. There is no delete or
reset action; IDs are never reused within a task. A task permits 50 items and each
bot/project/session branch permits 64 task keys. Task keys allow 80 characters,
item text 500, and each reason, next action, outcome or verification field 2000.
Start a new bounded task/session when appropriate rather than accumulating backlog.

## Recovery and effects

Lists are scoped to the bot, selected project, task key and active Pi session
branch. Returning to a project and task in that session restores its list. A fork
inherits only selected ancestry; navigating to an earlier branch restores that
point's state. Compaction does not delete session entries; a recovery inventory
is supplied before each model request, then `list` restores the full details.

Resume the original Pi session after restart. An unrelated new session starts
empty, and deleting session files deletes their todo record. No memory database,
repository artifact, Linear issue, specification status, reminder or permission
is changed. Lists are private execution bookkeeping for one bot, not a team queue.
Session snapshots may contain sensitive project notes; use normal session-data
protection and avoid secrets in item text.
