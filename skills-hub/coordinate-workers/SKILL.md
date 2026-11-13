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

For example, sequence two assignments that edit the same workspace through an
immutable dependency and inspect their asynchronous evidence before integrating.
**Why:** it prevents collisions without inventing a per-TODO scheduler. Avoid
dispatching individual TODOs and waiting for each synchronously; that duplicates
runtime control and stalls independent work.
