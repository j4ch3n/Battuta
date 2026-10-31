---
name: todo
description: Use when tracking multi-step work, resuming execution after a context change, revising remaining steps, or recording completed and cancelled outcomes, with or without a project.
---

# Execution TODOs

Keep intended steps and recorded outcomes in execution order. Tracking is optional;
use a list when it helps continuity, not as a prerequisite for every request.

## Workflow

1. Choose project scope only for work owned by the selected project; otherwise use general.
2. Inspect current work before creating a list. Resume or extend it when appropriate;
   replacing unfinished work requires owner approval.
3. Inspect the next or remaining items to regain orientation. Complete or cancel
   only the next item, recording its actual outcome and relevant verification.
4. Report progress in ordinary language, not a storage dump. A completed TODO is
   not milestone acceptance, an approved commitment, or execution authorisation.

PM and TL maintain independent work. A handoff can associate their lists without
synchronising ownership or status. Notes and drafts are separate working material;
neither is required to use TODOs. Never store credentials or invent outcome evidence.

## Scope and current work

PM and TL invoke `battuta-project todo` through the shell. `AGENT_ROLE` selects
`pm` or `tl`; `--scope` is always explicit:

- `project`: work owned by the selected registered project. Confirm selection with
  `battuta-project current` and switch if needed. Do not assign unrelated work to
  a project just because it is selected.
- `general`: unrelated work or uncertain project ownership; needs no selected
  project and does not change project selection.

Each scope/role has its own current work ID and list across sessions, not a list
per request. Project selection is resolved at invocation time. The other role's
pending items do not block your work. An absent list is successful discovery and
creates no storage. Do not run multiple instances of the same role on the same
work concurrently.

## Inspect and advance

```sh
battuta-project todo --scope general list --next
battuta-project todo --scope general list --remain
battuta-project todo --scope general list
```

`--next` shows the first remaining item; `--remain` shows all remaining items in
execution order. Both preserve original IDs, progress counts and the next-item
indicator without changing storage. Combining the filters is rejected. Without
a filter, `list` includes completed/cancelled work and its recorded explanations.

```sh
battuta-project todo --scope general done \
  --rational "Compared the supported formats against the supplied requirements; CSV meets the confirmed import needs."
battuta-project todo --scope general cancel \
  --rational "The confirmed scope excludes legacy XML, so that comparison is no longer needed."
```

`done` completes only the first `todo` item; `cancel` cancels it without claiming
success. Both require a nonblank `--rational` explaining the actual outcome and
relevant verification, or why the step is cancelled. Missing/blank explanations
are rejected without changes. The CLI records explanations, not their truth.

These commands work in either scope. There is no target-ID option or out-of-order
completion. Finished lists report `No remaining TODO items.` Status updates never
implicitly create a list.

## Create or replace work

```sh
battuta-project todo --scope general create \
  --item "Review the owner's requirements" \
  --item "Compare available options" \
  --item "Present a recommendation"
```

Repeat `--item` for each nonblank description in execution order. IDs start at 1,
status is `todo`, and `rational` is initially empty. Creation generates a new
five-character lowercase alphanumeric work ID, leaving the other role unchanged.
It succeeds when no previous list exists or all previous items are finished.

If unfinished work exists, creation fails without changes. Ask the owner whether
to resume/revise it or abandon it. Only after explicit approval to abandon it:

```sh
battuta-project todo --scope general create --force \
  --item "Assess the revised request" \
  --item "Report findings"
```

`--force` bypasses only the unfinished-work check. It creates a new file and keeps
the old file unchanged, including unfinished items. It does not bypass validation,
storage failures or work-ID allocation errors. The CLI cannot verify conversational
consent. A list is not required for unrelated work.

## Associate work through a handoff

Creation reports a reference such as `Work: pm:k7m2q`. Without `--related-to`, it
also returns optional bot-mail handoff guidance. When coordination helps, include
the exact reference and project name or general scope in the message. The other
role can create independent work:

```sh
# TL, after selecting the same project named in PM's message:
battuta-project todo --scope project create --related-to pm:k7m2q \
  --item "Assess the technical implications"
```

Either role can initiate a handoff. Mail is not sent automatically; the recipient
does not need ceremonial TODOs merely to acknowledge a message.

`--related-to <role>:<work-id>` records a one-way association, not a shared ID or
synchronized lifecycle. The target must be recorded in the same project/general
scope; historical work is valid. The relationship survives either role starting
later work. Associated creation shows `Related to:` instead of another initial
handoff example. It never changes the target or the other role's current work.

## Append or revise steps

```sh
battuta-project todo --scope general extend \
  --item "Address the new feedback" \
  --item "Verify the revision"
```

`extend` appends consecutive IDs, preserving existing records and the relationship.
It works after every item is finished, creates no new work ID, and accepts neither
a destination ID nor `--related-to`. Without current work, use `create` first.

```sh
battuta-project todo --scope general update-todo \
  --item "Compare the two supported options" \
  --item "Present the trade-offs"
```

`update-todo` requires at least one replacement description and replaces all
remaining `todo` items in execution order. Completed/cancelled items and their
explanations remain unchanged. Replacement IDs continue after that prefix and
their explanations start empty.

There is no individual deletion/edit or out-of-order completion. IDs describe
positions, not stable identities across a rewrite. With no remaining items,
create new work or extend the same work. `update-todo` never creates a list.

## Output, resumption and recovery

Reads and mutations report the operation, scope/project, role, work reference and
optional relationship (except legacy lists without an ID), file location, visible
items with ID/status/description/explanation, and done/cancelled/remaining counts.
`Next:` identifies the first remaining item. Use `list` after a session restart,
not automatic replacement work. A work ID identifies one role's work, not a Pi
run or thread. Notebooks have independent identities; TODO creation never rotates
a notebook.

Older lists without a work ID remain readable and can be completed, cancelled or
revised. Finish/cancel their remaining steps or obtain approval for `create --force`
before starting new work. Use `create` before `extend` on such lists. Each role
can transition independently.

Failures return nonzero with recovery guidance; the CLI never waits for interactive
input. Follow the reported guidance rather than looking up failure codes. If an
owner decision is required, ask in the originating conversation and pause that
mutation. After repair, read the list before retrying. Never use force to bypass
corruption, switch to older history, or discard files after an interrupted command.

The CLI does not authorize work, change specifications or Linear issues, schedule
reminders, or store durable memory. Treat TODOs as private project/owner information.
