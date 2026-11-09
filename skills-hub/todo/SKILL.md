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
use project-context to inspect registered context and ask the responsible requester
when the commission lacks its project. Do not silently substitute global selection.
Workers currently stay on the same project; this workflow does not change global
project configuration.

Inspect related work before creating duplicates. Multiple assignments may be open
per project. Create the entire initial TODO list atomically, with goal, authority,
constraints, acceptance/input references, and existing prerequisite IDs. Dependencies
may cross projects but remain immutable; only prerequisites done unlock execution.
Duplicate prerequisite IDs mean one dependency. Cancelled prerequisites do not
satisfy dependents. Choose non-conflicting workspace boundaries or dependencies.

## Manager and inspection tools

| Tool | Inputs beyond project/assignment ID | Use |
| --- | --- | --- |
| create_assignment | goal, nonempty initial_todos, optional constraints and depends_on_assignment_ids | Publish one complete initial plan; requires project, not an existing assignment ID |
| list_assignments | optional project and status | Inspect global or project work, readiness, and claim timestamps; no assignment ID |
| get_assignment | None | Read authoritative detail, evidence, dependencies, and ordered TODOs |
| append_todos | nonempty descriptions array | Append consecutive positions to active/blocked work |
| update_todo | position, exact expected_updated_at, description and/or status: cancelled | Edit/cancel unfinished active/blocked work, not execution outcomes |
| close_assignment | status: cancelled | Cancel nonterminal work without rewriting TODO evidence |
| reactivate_assignment | None | Return blocked work to active after resolving/cancelling blocked/in-progress TODOs and leaving executable work |

Assignment states: active, in_process, blocked, done, cancelled. TODO states:
todo, in_progress, blocked, done, cancelled. Positions never shift; no reorder,
deletion, TODO dependency graph, or per-TODO claims. Execution APIs are code-owned;
workers use execute-assignment rather than directly maintaining status.

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
