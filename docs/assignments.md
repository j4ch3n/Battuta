# Shared assignment runtime

Supabase owns assignments, immutable prerequisites, and ordered TODOs. The
`assignments` Edge Function exposes strict MCP tools over stateless Streamable
HTTP. CoS defines the problem/authority; Manager publishes complete plans and
judges results; [persistent workers](workers.md) execute assignments.

## Storage and identity

All targeted calls require exact `project` and eight-lowercase-hex `assignment_id`.
IDs are real short primary keys, with collision retries, not truncated aliases.
The server validates name/key shape and matching ownership, not local project
registration. Unknown or mismatched project/ID returns `not_found`.

| Table                     | Fields and constraints                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assignments`             | ID, explicit project, nonblank goal, constraints, status, optional notes_path/blocker, created_at/updated_at/closed_at, claimed_at/lease_expired_at                    |
| `todos`                   | Composite key assignment_id + positive immutable position, nonblank description, status, outcome summary, evidence text array, optional blocker, created_at/updated_at |
| `assignment_dependencies` | Unique assignment_id + prerequisite_assignment_id; existing assignments only, no self-edge, immutable after creation                                                   |
| `assignment_availability` | One singleton row containing a monotonically increasing revision; no assignment payload or delivery ledger                                                             |

Multiple assignments may be open in one project. Creation atomically saves a
nonempty initial TODO batch and deduplicated prerequisite IDs, then signals
availability. Missing IDs reject the entire plan and return all missing IDs.
Prerequisites may cross projects; only `done` satisfies them. Cancelling a
prerequisite does not unlock its dependents. Existing-only, creation-time edges
avoid cycles without a mutable dependency graph API.

TODOs stay in ascending position. Appending atomically allocates consecutive
positions. There is no renumbering, deletion, per-TODO ownership, or TODO graph.
Complete JSON aggregates avoid PostgREST row-limit truncation; assignment lists
order by creation time then ID, descending.

## State and execution

Assignment states are `active`, `in_process`, `blocked`, `done`, `cancelled`.
TODO states are `todo`, `in_progress`, `blocked`, `done`, `cancelled`.

An atomic claim locks a ready active assignment and returns the full plan with
an exact `claimed_at` version and server-computed `lease_expired_at` 45 minutes
later. Exactly one contender wins. Readiness requires satisfied prerequisites,
no blocked/in-progress TODO, and at least one `todo` item.

**The lease is informational, not a deadline.** Age never renews, releases,
reclaims, stops, filters, or rejects a claim. Keep claim and item-version strings
unchanged: JavaScript Date conversion loses PostgreSQL microseconds.

| MCP tool                              | Authority and effect                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_assignment`                   | Manager publishes goal, complete initial_todos, optional constraints and depends_on_assignment_ids                                             |
| `list_assignments` / `get_assignment` | Inspect global/project/status work or scoped detail, including dependency status/readiness                                                     |
| `append_todos` / `update_todo`        | Manager appends or edits/cancels unfinished active/blocked work; exact expected_updated_at required for updates                                |
| `close_assignment`                    | Cancel nonterminal work without rewriting TODO results                                                                                         |
| `reactivate_assignment`               | Explicitly return blocked work to active after resolving/cancelling blocked/in-progress TODOs and leaving executable TODOs; clear former claim |
| `claim_assignment`                    | Code-owned whole-assignment claim                                                                                                              |
| `start_todo`                          | Code-owned current-claim operation; exact item token, first unfinished position, no parallel TODO                                              |
| `record_todo_result`                  | Code-owned completed/blocked report, summary/evidence and required blocker for blocked; block assignment and TODO atomically                   |
| `block_assignment`                    | Code-owned claim-bound runtime blocker, also blocking a running TODO                                                                           |
| `finish_assignment`                   | Code-owned current-claim completion only for a nonempty all-done/cancelled TODO set                                                            |
| `prepare_notes` / `locate_notes`      | Establish/locate the shared local note path and current editability                                                                            |

Mutations serialize on the parent assignment row. Claims fence execution; TODO
writes also compare exact `expected_updated_at`. Terminal work cannot reopen.
Repeated confirmed same-claim completion/blocking and same-state cancellation
are idempotent where supported; this is not blanket write-retry permission.
Completed evidence survives cancellation and blocked-work recovery. Manager must
replace an assignment to change immutable dependencies and inspect downstream plans.

## Permissions, availability, and uncertainty

Assignment/TODO/dependency tables are RPC-only even for the service role. RLS is
enabled, helpers are private, and security-definer functions use qualified names
with an empty search path. The shared backend secret is trusted same-owner
authority, not per-worker authentication or a tenant boundary.

Only the singleton revision is published through Realtime Postgres Changes;
service-role subscribers can read it. Anonymous/authenticated users cannot read
its row. Revision events are coalescible hints, not ownership, payloads, or queues.
Workers reconcile on startup/reconnect/idle and through one fallback timer.

Expected refusals carry structured recovery data and `isError`. Unexpected
errors are sanitized. After uncertain writes, inspect exact authoritative state
before repeating; never infer ownership from a lost claim response. Database
mutations do not send mail: worker extension code persists outcomes first, then
attempts mandatory Manager mail once. A mail failure never rolls back execution.

## Local working material

Preparation establishes one absolute path:

```text
<local-Battuta-root>/projects/<project>/work/<assignment-id>/note.md
```

Matching preparation is harmless; conflicting roots fail rather than relocate.
The server checks lexical path safety, not filesystem permissions, symlinks, or
existence. Pi file tools must inspect safe local paths and preserve content.
Long drafts may live beside the note and be referenced from it or TODO evidence.
No file synchronization is provided; another host may lack the referenced file.

Only `done`/`cancelled` freezes notes/drafts; active/in_process/blocked remain
editable. Freezing is a team convention, not filesystem enforcement. Terminal
notes cannot initialize a new path. No file locks, history, or undo are promised.

The existing project CLI and global current-project value are unchanged.
Historical/private material is neither imported nor rewritten. Assignment
completion is execution state, not Manager verification or owner acceptance.

## Verification boundaries

Database tests cover atomic plans, prerequisite gating, competing claims,
ordered execution, token conflicts, parent-lock races, late results, recovery,
large reads, collision retries, and note paths. pgTAP tests privileges; authenticated
Realtime and real MCP tests cover transport/privacy. Actual Pi integration uses
loopback provider stubs and test-owned records, including real local mail.
These checks do not establish live-model compliance or product acceptance.
