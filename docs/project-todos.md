# Execution TODO persistence

Technical reference for the project-context CLI's role-local work state and TODO
storage. For invocation and bot workflows, use the
[TODO command reference](../shared-skills/todo/references/commands.md).

## Storage and current-work selection

Project files live under `~/.battuta/projects/<project>/work/`; general files live
under `~/.battuta/work/`. Filenames are `todo-<role>-<work-id>.jsonl`, for example
`todo-pm-k7m2q.jsonl`.

The role-local pointer in `~/.battuta/projects/.config.json`, not file ordering or
modification time, selects the current list:

- Project: `projects.<project>.roles.<role>.currentWorkId`.
- General: `general.roles.<role>.currentWorkId`.

General creation may initialize this config but never registers or selects a
project. Missing configuration mappings default to empty; malformed state is
rejected without resetting it. Unknown top-level, project, and role metadata is
preserved during updates.

Each role's `works` mapping retains metadata keyed by ID, including optional
`relatedTo`. Older entries are retained when the pointer changes. References are
resolved against retained metadata within the same project/general boundary, not
the target role's current pointer.

Work IDs use five lowercase ASCII letters/digits generated with `secrets.choice`.
Allocation is shared with notebooks and checks both roles' retained metadata and existing TODO/notebook paths, including
symlinks and unpublished orphan files, retrying up to 100 candidates without
overwriting history.

## JSONL records

Each record contains only `id`, `status` (`todo`, `done`, or `cancelled`),
`description`, and `rational`. The rational starts empty for TODO items and must be
nonblank for done/cancelled items. IDs are consecutive from 1. Completed/cancelled
items form a prefix followed by remaining TODO items.

Updates atomically rewrite the active file; only creation makes a new work file.
Older lists remain as history. Relationship metadata stays in config, not item
records. Item IDs remain positional rather than stable across `update-todo`
replacement.

## Locking and filesystem safety

Registry selection updates and TODO operations share `<registry>/.config.lock`.
TODO operations also acquire the role's `.work-<role>.lock` in its work directory,
after the registry lock. Locks use `flock` and validate regular-file/directory
boundaries; symlinks cannot redirect managed writes. Absent reads do not initialize
storage.

Configuration read/modify/write is protected by the shared lock so concurrent
role publication and project switching preserve pointers, relationships, and
selection. Commands do not pin callers to earlier versions. The runtime assumes
one instance per role; no leases, thread tracking, or cross-run scheduling exist.

## Legacy selection and publication failures

Before a role publishes its first work ID in a scope, its latest validated
timestamped file supplies reads and the pending-work guard. Legacy filenames use
`todo-<role>-<UTC timestamp>.jsonl`, such as `todo-pm-20261023T143015Z.jsonl`.
Filename order, not modification time, determines legacy selection. Each role
transitions independently; creation leaves legacy files untouched.

After publication, there is no fallback to legacy files. A missing current file
is a storage inconsistency, not permission to initialize a replacement or use
older history. Force cannot bypass corrupt data or unsafe paths.

Creation writes the new list before publishing its pointer and metadata. A normal
config-write failure removes only the new unpublished file and retains prior
state. A crash between writes can leave an orphan; retain it for recovery. It is
never selected automatically and its ID remains reserved by the existing path.
This is recoverable two-file publication, not a filesystem transaction.

## Implementation and checks

Implementation lives in `shared-skills/project-context-cli/src/battuta_project/`:
`models.py` validates metadata, `registry.py` manages configuration, `storage.py`
provides atomic writes/locks, and `todos.py` manages ordered lists. Co-located
package tests cover discovery, state preservation, associations, collisions,
legacy continuation, concurrency, and failed writes. See
[code checks](../.agents/skills/battuta-verify/references/checks.md) for verification.
