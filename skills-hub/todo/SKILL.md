---
name: todo
description: Use when creating complete project assignments, inspecting shared progress, or recovering blocked work through cancellation and replanning.
---

# Shared assignments and TODOs

## Objective

Maintain complete, executable assignment plans and authoritative progress
visibility without conflicting with runtime-owned execution state.

## Roles, capabilities, and boundaries

Use the assignments MCP service to create, inspect, and recover assignment
plans. Manager is the authority that plans and evaluates evidence; CoS supplies
product authority; Worker extension code owns execution progress, completion,
blockers, and mandatory Manager summaries. These definitions do not restrict
who can use the skill or grant tools. A recorded result is not product acceptance.

## Identity and creation

Keep explicit project and returned eight-character assignment ID on targeted
calls. For bound execution, use Manager's supplied identity and inputs; report
missing context through execute-assignment. For planning outside a bound task,
use project-management to inspect registered context and ask the responsible requester
when the commission lacks its project. Do not silently substitute global selection.

Inspect related work before creating duplicates. Multiple assignments may be open
per project. Create the entire initial TODO list atomically, with goal, authority,
constraints, acceptance/input references, and existing prerequisite IDs. Dependencies
may cross projects but remain immutable; only prerequisites done unlock execution.
Duplicate prerequisite IDs mean one dependency. Cancelled prerequisites do not
satisfy dependents. Choose non-conflicting workspace boundaries or dependencies.
Omit `require_abilities` for ordinary work; it defaults to `["research"]`. Omit `difficulty` for easy work; levels are `easy`, `medium`, `hard`, `hail_mary`.
For influencer work, explicitly require `["mobile-control"]`. Empty requirements
are invalid. Unknown names reject the whole write; read the correction message
rather than guessing aliases.
Workers claim matching work automatically; do not set or change ownership yourself.
Keep appended TODOs compatible with the assignment's requirements;
replace the assignment when requirements must change.

## Manager and inspection tools

| Tool | Inputs beyond project/assignment ID | Use |
| --- | --- | --- |
| create_assignment | goal, nonempty initial_todos, optional constraints, depends_on_assignment_ids, require_abilities and difficulty | Publish one complete initial plan; requires project, not an existing assignment ID |
| list_assignments | optional project and status | Inspect all or project work, readiness, and claiming bot; no assignment ID |
| get_assignment | None | Read authoritative detail, evidence, dependencies, and ordered TODOs |
| append_todos | nonempty descriptions array | Append consecutive positions to active/blocked work |
| update_todo | position, exact expected_updated_at, description and/or status: cancelled | Edit/cancel unfinished active/blocked work, not execution outcomes |
| close_assignment | status: cancelled | Cancel nonterminal work without rewriting TODO evidence |
| reactivate_assignment | None | Return blocked work to active after resolving/cancelling blocked/in-progress TODOs and leaving executable work |

Assignment states: active, in_process, blocked, done, cancelled. TODO states:
todo, in_progress, blocked, done, cancelled. Positions never shift; no reorder,
deletion, TODO dependency graph, or per-TODO claims. Execution APIs are code-owned;
workers use execute-assignment rather than directly maintaining status.

## Read returned results

On `ok: true`, use the returned assignment and TODOs rather than assuming your
requested change is the current state. Keep its project and assignment ID for
later calls.

| Field | How to use it |
| --- | --- |
| `status` | Distinguish waiting (`active`), claimed (`in_process`), blocked, and terminal work |
| `ready` | See whether prerequisites and TODO state currently permit a claim; it does not reserve work |
| `claimed_by` | The claiming bot's Agent Mail mailbox, such as `worker-1`; mail it to chase or steer that bot. A retained name is not proof it is still running, and a blank name alone does not prove work is available |
| `lease_expired` | True when an `in_process` assignment's worker stopped renewing its lease; the database then blocks it and mails you an expiry notice. Treat the notice like any other blocker: the worker stopped or is unreachable, so cancel the assignment or create a replacement one difficulty level up. Always false for blocked, done, and other states |
| `require_abilities` | Read the exact abilities a worker must all satisfy |
| `difficulty` | Read the Manager's advice on how demanding the work is; the worker decides the model |
| TODO `summary` / `evidence` / `blocker` | Evaluate actual outcomes, verification, and missing inputs before accepting results or replanning |

On `ok: false` or a tool error, read the explanation and use the returned error
code and recovery state. A readable message explains the problem; structured
fields identify what to refresh or correct. Do not treat a rejected call as saved.

A worker's reply to a progress request that shows steady progress needs no
action. One that shows repeated retries, workarounds, or no clear path means
redirect the worker by mail, or cancel and replan.

## Recovery and uncertainty

Manager may cancel blocked work and create replacements, or cancel unfinished
TODOs, append revised steps, and explicitly reactivate. Retain completed evidence.
Reactivation invalidates the former claim. If dependencies must change, replace
the assignment and inspect downstream work; terminal assignments cannot reopen.

Pass update tokens unchanged, never through Date/clock conversion. On stale_update,
inspect/reconcile the returned item. On missing_dependencies, use list_assignments
to find the correct IDs. After uncertain creation/appending, inspect before
repeating; a lost response does not prove nothing was saved. No local TODO fallback.

Only done/cancelled freezes notes/drafts; blocked material remains editable.
Manager reports meaningful outcomes, evidence, blockers, and decisions through
communicate-with-cos asynchronously, without routinely marking worker execution done.

## Why and examples

Create one assignment with its nonempty, ordered initial TODO list, authority,
acceptance, and existing prerequisites. **Why:** atomic planning prevents workers
from claiming a partial plan or conflicting workspace work.

Avoid creating an assignment and appending its initial plan later, or manually
writing a worker execution success. **Why:** the first loses the creation
guarantee; the second destroys the extension-owned evidence and settlement path.
