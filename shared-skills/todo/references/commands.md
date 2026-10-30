# Execution TODO commands

TODOs preserve intended work and recorded outcomes across context changes, helping
bots recover the next step without reconstructing a plan. Their use is optional;
bots decide whether a list helps. Notes separately retain learnings, findings, and
thoughts; neither capability requires the other.

Both PM and TL invoke `battuta-project todo` through the shell;
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

For a list you choose to maintain, completion/cancellation advances only the next
TODO in top-down execution order and records its detailed rational. Using a list
is not a prerequisite for doing work.

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

If unfinished work exists, creation fails without changing the list. Before
replacing that list, ask the owner whether to resume/revise it or abandon it.
This protects tracked work; it does not require a list for unrelated work.
Only after explicit approval to abandon the previous work, run:

```sh
battuta-project todo --scope general create --force \
  --item "Assess the revised request" \
  --item "Report findings"
```

`--force` bypasses only the unfinished-work check. It creates a new file and keeps
the old file unchanged, including unfinished items. It does not bypass validation,
storage failures, or work-ID allocation errors. The bot must obtain approval; the CLI
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
requires an owner decision, ask in the originating conversation and pause that
list-changing operation until they respond. After fixing a storage problem, read the current list
before retrying a mutation.

The CLI never waits for interactive terminal input. It does not authorize work,
change specifications or Linear issues, schedule reminders, or store durable memory.

## Resume existing work

A work ID identifies one role's work across Pi-session restarts, not a Pi run or
thread. An item ID is a position within its list. Notebooks have independent work
identities and selections; TODO creation never rotates a notebook. Use `list` to
reorient after a restart rather than creating replacement work automatically.

Older lists without a work ID can still be read, completed, cancelled, or revised.
Finish/cancel their remaining steps or obtain owner approval for `create --force`
before starting new work. Use `create` before attempting `extend` on such work.
Each role can make this transition independently.

If current work cannot be read, follow the reported repair guidance. Do not use
force to bypass corruption, switch to older history, or discard files after an
interrupted command. After repair, read the current list before retrying.

Each role uses its current work across sessions in the same scope, not a separate
list for every request. Do not run multiple instances of the same role on the same
work concurrently. Keep item descriptions free of secrets and treat todos as
private project/owner information.
