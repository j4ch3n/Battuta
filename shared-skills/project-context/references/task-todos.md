# Execution TODO commands

Use TODOs to keep track of the next step and remaining work during long-running,
multi-step tasks. Both PM and TL invoke `battuta-project todo` through the shell;
owners can ask for progress in ordinary Telegram conversation. Return a readable
summary, not a terminal screenshot or a JSONL dump.

## Choose scope and inspect

```sh
battuta-project todo --scope project list
battuta-project todo --scope general list
```

Choose project scope when the task belongs to the selected project, based on the
request and project overview. Confirm selection with `battuta-project current`;
switch to the intended registered project if needed. Do not assign unrelated work
to a project just because it is selected. Use general scope when ownership is
uncertain or the work is not project-specific; it requires no selected project.

`AGENT_ROLE` selects `pm` or `tl`. Each scope/role has one active list: its latest
timestamped file. Project selection is resolved at invocation time; general scope
does not change project selection. Check existing work before creating another list.
An absent list is a successful discovery result and does not create storage.

## Create steps in execution order

```sh
battuta-project todo --scope general create \
  --item "Review the owner's requirements" \
  --item "Compare available options" \
  --item "Present a recommendation"
```

Repeat `--item` for each nonblank description. A new list starts with ID 1 and
status `todo` and an empty `rational` for every item. Creation succeeds when no previous list exists or
all previous items are `done`/`cancelled`.

If unfinished work exists, creation fails without changing the list. Ask the owner
whether to resume/revise it or abandon it, and pause the new work until they decide.
Only after explicit approval to abandon the previous work, run:

```sh
battuta-project todo --scope general create --force \
  --item "Assess the revised request" \
  --item "Report findings"
```

`--force` bypasses only the unfinished-work check. It creates a new file and keeps
the old file unchanged, including unfinished items. It does not bypass validation,
storage failures, or timestamp collisions. The bot must obtain approval; the CLI
cannot independently verify conversational consent.

## Advance or revise

```sh
battuta-project todo --scope general done \
  --rational "Compared the supported formats against the supplied requirements; CSV meets the confirmed import needs."
battuta-project todo --scope general cancel \
  --rational "The confirmed scope excludes legacy XML, so that comparison is no longer needed."
battuta-project todo --scope general update-todo \
  --item "Compare the two supported options" \
  --item "Present the trade-offs"
```

- `done` completes only the first `todo` item. Its required `--rational` records a
  detailed explanation of the actual outcome and relevant verification.
- `cancel` cancels only the first `todo` item without claiming success. Its required
  `--rational` explains why that step is cancelled.
- Missing or blank explanations are rejected without changing the list. The CLI
  records the explanation but does not independently verify its truth; never invent it.
- `update-todo` requires at least one replacement description and replaces all
  remaining `todo` items in execution order. Completed/cancelled items remain
  unchanged, including their rational explanations; replacement IDs continue
  immediately after that prefix and their rational fields start empty.

There is no target-ID option, individual deletion/edit, or out-of-order completion.
IDs describe positions in the current plan, not stable identities across a rewrite
of the remaining steps. When no TODO items remain, start a new list for new work.
Neither advancement nor `update-todo` implicitly creates a list.

## Output and failure handling

Successful list reads and mutations report the operation, scope/project, role,
file location, every item with ID/status/description and any rational explanation, and done/cancelled/remaining
counts. `Next:` identifies the first remaining item; finished lists explicitly say
`No remaining TODO items.` Consult this output when reorienting and before advancing.

When a command fails, it returns nonzero and explains what went wrong and what to
do next. Follow that guidance rather than looking up failure codes. If the message
requires an owner decision, ask in the originating conversation and pause the new
work until they respond. After fixing a storage problem, read the current list
before retrying a mutation.

The CLI never waits for interactive terminal input. It does not authorize work,
change specifications or Linear issues, schedule reminders, or store durable memory.

## Storage contract

Project files live under `~/.battuta/projects/<project>/todos/`; general files live
under `~/.battuta/todos/`. Filenames are `todo-<role>-<UTC timestamp>.jsonl`, for
example `todo-pm-20261023T143015Z.jsonl`. The timestamp has second precision.
The latest matching filename, not modification time, selects the active list.

Each JSONL record contains only `id`, `status` (`todo`, `done`, or `cancelled`),
`description`, and `rational`. The rational starts empty for TODO items and must be
nonblank for done/cancelled items. IDs are consecutive from 1. Completed/cancelled items form a
prefix followed by the remaining TODO items. Updates atomically rewrite the active
file; only creation makes a new timestamped file. Older lists remain as history.

Lists are independent of Pi sessions; each role's list is shared by that role's
sessions in the same scope, not a separate list for each request. Commands serialize
access, but do not pin a caller to a previous version. Store no secrets in item
descriptions and protect these files as private project/owner notes.
