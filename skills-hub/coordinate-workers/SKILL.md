---
name: coordinate-workers
description: Use when coordinating assignment execution, resolving questions, reviewing results or replanning the next milestone.
---

# Coordinate workers

## Objective

Integrate independently executed assignments into a verified outcome while
keeping conflicting work ordered.

## Capabilities and boundaries

Persistent workers execute whole assignments; the runtime owns scheduling and
execution-state writes. Manager evaluates and integrates evidence, and CoS
resolves product or authority decisions. These roles describe responsibilities,
not who may use this skill or access its tools.

## How and why

Review the current milestone's evidence before publishing the next milestone's
assignments. Adapt the plan to findings rather than guessing all later work.
Follow the invoking agent's existing authority and escalation boundaries.

Plan complete assignments using todo, with ordered initial TODOs and existing prerequisites. Persistent workers claim whole assignments; do not dispatch individual TODOs, select a worker, create a scheduler, or wait synchronously. Use dependencies/non-conflicting boundaries when assignments share a workspace.

Receive completed/blocked summaries through Agent Mail and inspect authoritative state and actual evidence. Worker extension code owns execution-state writes and mandatory result delivery. Manager reviews verification evidence and integrates results and reports meaningful outcomes, risks, and decisions to CoS; reported success is not owner acceptance.

For blockers, cancel/replace the assignment or cancel unfinished TODOs, append replacements, and reactivate explicitly. Preserve completed evidence. Dependencies cannot be edited and cancelled prerequisites do not unlock dependents; replace affected downstream plans when needed. No terminal reopening, age-based reclaim, nested assignments, or original-worker affinity. Escalate product/authority decisions to CoS with a recommendation.

## Ticket lifecycle

Keep each Linear ticket's status truthful as delivery progresses, in both
foundation and routine work. Linear status is separate from assignment state:
the runtime owns execution state, and a worker report is evidence, not a ticket
transition.

| Observed event | Ticket action |
| --- | --- |
| Work authorized but not started | Keep the planned or ready state. Creating an assignment does not prove work started. |
| Implementation actually starts | Move to the team's active-work state. |
| A PR opens | Associate it with the issue. A draft can stay in active work; when it is ready for review, use the team's review state where one exists. An open PR is not done. |
| Review requests changes or verification fails | Reflect the ongoing correction or the actual blocker; never imply ready to merge or complete. |
| Foundation change awaits owner approval | Keep the issue non-complete and make the pending approval visible through a status or a short issue comment. |
| A PR merges | Check the whole ticket's scope and acceptance. Mark complete only when required work, reviews, verification, integration and any applicable approval are satisfied. |
| A PR closes unmerged, work blocks, or work resumes | Reconcile the status with the remaining work. A closed PR neither completes nor cancels its ticket. |

- Read the team's statuses first (`list_issue_statuses`) and use its actual names and completion policy; never hard-code names or add a workflow. With no review or blocked state, use the closest truthful state and record the checkpoint in a comment.
- One ticket can span several assignments or PRs. One merged PR does not complete it while required scope remains.
- A ticket that requires release or product acceptance stays open until that holds; routine tickets do not wait for an owner gate that does not apply.
- Check current issue and PR state, make the narrowest authorized update, preserve unrelated metadata as the `ticket-writing` skill describes, and read the saved result back before reporting success.
- When GitHub or Linear automation already made the correct transition, verify it instead of repeating it. A premature automated close, such as a foundation ticket closed before owner approval, is a discrepancy to reverse or annotate and report to CoS, not proof of delivery.
- Inspect a failed or uncertain update before retrying, and report any unresolved tracker mismatch.

For example, sequence two assignments that edit the same workspace through an
immutable dependency and inspect their asynchronous evidence before integrating.
**Why:** it prevents collisions without inventing a per-TODO scheduler. Avoid
dispatching individual TODOs and waiting for each synchronously; that duplicates
runtime control and stalls independent work.
