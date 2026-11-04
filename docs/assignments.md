# Shared assignment runtime

Supabase is authoritative for assignments and ordered TODOs. The custom
`assignments` Edge Function exposes the MCP service over stateless Streamable
HTTP. Bot usage is maintained in the todo and note-taking runtime skills.

## Storage contract

`public.assignments`:

| Column                     | PostgreSQL type                      | Meaning                                                    |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `id`                       | `text primary key`                   | First eight lowercase UUID hex characters; `^[0-9a-f]{8}$` |
| `project`                  | `text not null`                      | Explicit exact registered-project name                     |
| `goal`                     | `text not null`                      | Nonblank commission                                        |
| `constraints`              | `text not null default ''`           | Authority, boundaries, acceptance/input references         |
| `status`                   | `text not null default 'active'`     | `active`, `done`, `cancelled`                              |
| `notes_path`               | `text null`                          | Shared absolute local path, established once               |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Assignment timestamps                                      |
| `closed_at`                | `timestamptz null`                   | Present exactly when terminal                              |

A partial unique index on `project WHERE status = 'active'` permits only one
active assignment per project. ID generation retries collisions up to 100 times,
without overwriting records. It distinguishes key collisions from active-project
conflicts. IDs are actual short keys, not aliases for stored full UUIDs.

`public.todos`:

| Column                     | PostgreSQL type                            | Meaning                                             |
| -------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `assignment_id`            | `text not null references assignments(id)` | Assignment owner                                    |
| `position`                 | `integer not null`, positive               | Immutable identity and order within assignment      |
| `description`              | `text not null`                            | Nonblank intended work                              |
| `status`                   | `text not null default 'todo'`             | `todo`, `in_progress`, `done`, `cancelled`          |
| `outcome`                  | `text not null default ''`                 | Actual outcome and evidence references              |
| `created_at`, `updated_at` | `timestamptz not null default now()`       | Item timestamps; updated time is the conflict token |

`PRIMARY KEY (assignment_id, position)` creates the only required item B-tree
index. No duplicate index or per-item UUID. Appends allocate consecutive positions;
updates preserve identity. No deletion, shifting, renumbering, group, or chain.
All lists explicitly order by position, regardless of execution order.

JSONB is used for RPC response envelopes only; neither table stores JSONB arrays.
Ordered aggregates return complete reads rather than relying on PostgREST's
default row limit. Historical assignment lists order by creation time then ID,
both descending.

## Transactions and permissions

The public RPCs are `assignment_create`, `assignment_list`, `assignment_get`,
`assignment_append_todos`, `assignment_update_todo`, `assignment_close`,
`assignment_prepare_notes`, and `assignment_locate_notes`. The Edge Function maps
the eight MCP tool inputs to these RPCs, without another local state machine.
Internal project/path helpers are not callable by API roles.

RLS is enabled; anonymous/authenticated roles have no table/RPC access. The shared
secret-authenticated backend may execute public RPCs but cannot directly mutate
the tables. Functions use a fixed empty search path and qualified names. All bots
have equal access. This is trusted same-owner access, not per-bot authentication
or a multi-tenant boundary. The secret key also carries broader Supabase authority;
keep it private and expose no unauthenticated endpoint.

Every targeted operation checks explicit project + assignment ID. Bots check local
registration; the server trusts that assertion, validates name/key shape and
ownership matching, and stores no duplicate project registry. A mismatched project
returns the same not-found response as an absent record.

Append, item update, close, and note preparation serialize on the parent row.
Multi-item appends are atomic. Items may change state in any order while active;
there is no blocked status or predecessor enforcement. Updates compare the exact
`expected_updated_at` token under lock and advance it by at least one microsecond.
Keep timestamp strings intact; JavaScript Date conversion loses precision.

Completion refuses with ordered unfinished items unless all are done/cancelled;
an empty assignment can finish. Cancellation skips that check and leaves item
statuses/outcomes untouched. Terminal records reject subsequent item mutations or
reopening; repeated same-state closure succeeds without timestamp changes. Either
terminal status frees the project. Closure is delivery state, not owner acceptance.

MCP returns structured results and signals expected business refusals with
`isError`. Unexpected backend errors are sanitized. After uncertain creation or
append, inspect before repeating: there is no exactly-once/recovery engine.
Manager updates progress and explicitly sends Agent Mail after each delivery;
database mutations never send mail automatically.

## Local working material

The bot expands its local home and passes an absolute Battuta root, normally
`~/.battuta`, to preparation. The resulting path is:

```text
<root>/projects/<project>/work/<8-character-assignment-id>/note.md
```

Store the absolute path once; matching preparation is harmless, conflicting roots
fail rather than relocate it. The server lexically validates roots/components,
but cannot inspect the host filesystem, permissions, symlinks, or file existence.
Pi file tools perform local creation/editing after safety checks and preserve
existing contents. Longer drafts may be adjacent files referenced from notes.

Both note tools recheck closure. Closed assignments return their existing path
and frozen/read-only guidance and cannot initialize a new path. Freezing is
prompt-level only: it cannot prevent direct same-user edits or a local race with
closure. No note locks, revision history, custom editor, or filesystem security
guarantee is provided.

The project CLI no longer owns local TODO/note/draft management. Existing files
and opaque historical registry metadata remain untouched and are not imported,
rewritten, or assigned synthetic IDs. Project registration/context and canonical
project-spec documents retain their existing responsibilities.

## Verification boundaries

Database integration covers ordering, collision retries, large reads, concurrent
creation/appends, lock serialization, tokens, closure, and note paths. pgTAP covers
permissions; real SDK transport tests cover auth, discovery and lifecycle. Unit
tests stub only the RPC boundary. Setup suites validate configuration without
calling bots/models. See the contributor check reference for commands. None of
these tests proves owner acceptance or hard note immutability.
