# Execution TODO commands

Use TODOs to keep track of the next step and remaining work during long-running,
multi-step tasks. Both PM and TL invoke `battuta-project todo` through the shell;
owners can ask for progress in ordinary Telegram conversation. Return a readable
summary, not a terminal screenshot or a JSONL dump.

## Choose scope

Choose project scope when the task belongs to the selected project, based on the
request and project overview. Confirm selection with `battuta-project current`;
switch to the intended registered project if needed. Do not assign unrelated work
to a project just because it is selected. Use general scope when ownership is
uncertain or the work is not project-specific; it requires no selected project.

`AGENT_ROLE` selects `pm` or `tl`. Each scope/role has its own current work ID and
list. Either role can create work without the other having a list; neither role's
pending items block the other. Project selection is resolved at invocation time; general scope
does not change project selection. Check existing work before creating another list.
An absent list is a successful discovery result and does not create storage.

## Basic usage

Work in top-down execution order: inspect the next TODO, perform that step, and
mark it done or cancelled with a detailed rational before moving to the next.

### Show the next item

```sh
battuta-project todo --scope general list --next
```

Show only the first remaining `todo` item without displaying the full history.

### Show remaining items

```sh
battuta-project todo --scope general list --remain
```

Show all remaining `todo` items in execution order. Both list filters preserve
original IDs, overall progress counts, and the next-item indicator. Neither
changes storage. Use one filter at a time; combining them is rejected.

### Complete or cancel the next item

```sh
battuta-project todo --scope general done \
  --rational "Compared the supported formats against the supplied requirements; CSV meets the confirmed import needs."
battuta-project todo --scope general cancel \
  --rational "The confirmed scope excludes legacy XML, so that comparison is no longer needed."
```

- `done` completes only the first `todo` item. Its required `--rational` records a
  detailed explanation of the actual outcome and relevant verification.
- `cancel` cancels only the first `todo` item without claiming success. Its required
  `--rational` explains why that step is cancelled.
- Missing or blank explanations are rejected without changing the list. The CLI
  records the explanation but does not independently verify its truth; never invent it.

These commands work in either scope. There is no target-ID option or out-of-order
completion. Finished lists explicitly report that no TODO items remain. Status
updates never implicitly create a list.

## Advanced usage

### Inspect the full list

```sh
battuta-project todo --scope general list
```

Without a filter, `list` shows all items, including completed/cancelled work and
their rational explanations.

### Create steps in execution order

```sh
battuta-project todo --scope general create \
  --item "Review the owner's requirements" \
  --item "Compare available options" \
  --item "Present a recommendation"
```

Repeat `--item` for each nonblank description. A new list starts with ID 1 and
status `todo` and an empty `rational` for every item. Creation succeeds when no previous list exists or
all previous items for this role are `done`/`cancelled`. Each creation generates a
new five-character lowercase alphanumeric work ID. The other role's work is unchanged.

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
storage failures, or exhausted ID allocation. The bot must obtain approval; the CLI
cannot independently verify conversational consent.

### Associate work through a handoff

Creation reports a shareable reference such as `Work: pm:k7m2q`. Without
`--related-to`, it also returns optional bot-mail handoff guidance. When coordination
is useful, include that exact reference and the ownership context (project name or
general scope) in the message to the counterparty. It can create independent work:

```sh
# TL, after selecting the same project named in PM's message:
battuta-project todo --scope project create --related-to pm:k7m2q \
  --item "Assess the technical implications"
```

Either role may initiate a handoff. PM leads through communication and responsibilities,
not exclusive creation rights. Mail is not sent automatically, and a counterparty
does not need ceremonial todos merely to acknowledge a message.

`--related-to <role>:<work-id>` records a one-way association on the new work, not a
shared ID or synchronized lifecycle. The target must be recorded in the same
project/general scope; historical work remains a valid target. The relationship
survives either role starting later work. Associated creation shows `Related to:`
instead of another initial handoff example. It never changes the target or the
counterparty's current work.

### Append steps to current work

```sh
battuta-project todo --scope general extend \
  --item "Address the new feedback" \
  --item "Verify the revision"
```

`extend` appends consecutive item IDs to this role's current list, preserving all
existing records and its relationship. It also works after every item is finished.
It creates no new work ID and accepts neither a destination ID nor `--related-to`.
Without a current work ID, use `create` first.

### Revise the remaining steps

```sh
battuta-project todo --scope general update-todo \
  --item "Compare the two supported options" \
  --item "Present the trade-offs"
```

`update-todo` requires at least one replacement description and replaces all
remaining `todo` items in execution order. Completed/cancelled items remain
unchanged, including their rational explanations; replacement IDs continue
immediately after that prefix and their rational fields start empty.

There is no target-ID option, individual deletion/edit, or out-of-order completion.
IDs describe positions in the current plan, not stable identities across a rewrite
of the remaining steps. When no TODO items remain, create new work or extend the
same work with additional steps.
Neither advancement nor `update-todo` implicitly creates a list.

## Output and failure handling

Successful list reads and mutations report the operation, scope/project, role,
work reference and optional relationship (except legacy lists without an ID),
file location, the visible items with ID/status/description and any rational explanation, and done/cancelled/remaining
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
under `~/.battuta/todos/`. Filenames are `todo-<role>-<work-id>.jsonl`, for example
`todo-pm-k7m2q.jsonl`. The role-local pointer in
`~/.battuta/projects/.config.json`, not file ordering or modification time, selects
the current list. Project work uses
`projects.<project>.roles.<role>.currentWorkId`; general work uses
`general.roles.<role>.currentWorkId`. General creation may initialize this config
but never registers or selects a project. Missing configuration mappings default
to empty; malformed state is rejected without resetting it.

Each role's `works` mapping retains metadata keyed by ID, including optional
`relatedTo`. Older entries are retained when the pointer changes. ID generation
checks both roles' retained metadata and existing paths, including symlinks and
unpublished orphan files, retrying up to 100 candidates without overwriting history.

Each JSONL record contains only `id`, `status` (`todo`, `done`, or `cancelled`),
`description`, and `rational`. The rational starts empty for TODO items and must be
nonblank for done/cancelled items. IDs are consecutive from 1. Completed/cancelled items form a
prefix followed by the remaining TODO items. Updates atomically rewrite the active
file; only creation makes a new work file. Older lists remain as history.

A work ID identifies one role's work across Pi-session restarts, not a Pi run or
thread. An item ID is a position within its list. Future notes can reference work
identity; notebooks and run provenance are not implemented here.

### Legacy recovery and interrupted creation

Before a role publishes its first work ID in a scope, existing timestamped lists
remain readable and can be completed, cancelled, or revised. Only that role's
latest validated timestamped list supplies the pending-work guard. Finish/cancel
it or obtain approval for `create --force`; creation preserves its original file.
`extend` requires a new-format current work ID. Each role transitions independently.

After publication, there is no fallback to legacy files. A missing current file
is a storage inconsistency to repair, not permission to start over or use older
history. Force cannot bypass corrupt data or unsafe paths.

Creation writes the new list before publishing its pointer and metadata. A normal
config-write failure removes only the new unpublished file and retains prior state.
A crash between writes can leave an orphan; retain it for recovery. It is never
selected automatically and its ID remains reserved by the existing path. This is
recoverable two-file publication, not a filesystem transaction.

Lists are independent of Pi sessions; each role's list is shared by that role's
sessions in the same scope, not a separate list for each request. Commands serialize
config and list changes, but do not pin a caller to a previous version. There is
one instance per role; no lease, thread tracking, or cross-run scheduling is provided.
Store no secrets in item
descriptions and protect these files as private project/owner notes.
