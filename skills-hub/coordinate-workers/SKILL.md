---
name: coordinate-workers
description: Use when coordinating multiple implementation workers, resolving their questions, or integrating delegated changes.
---

# Coordinate workers

Plan complete assignments using todo, with ordered initial TODOs and existing prerequisites. Persistent workers claim whole assignments; do not dispatch individual TODOs, select a worker, create a scheduler, or wait synchronously. Use dependencies/non-conflicting boundaries when assignments share a workspace.

Receive completed/blocked summaries through Agent Mail and inspect authoritative state and actual evidence. Worker extension code owns execution-state writes and mandatory result delivery. Manager verifies/integrates results and reports meaningful outcomes, risks, and decisions to CoS; reported success is not owner acceptance.

For blockers, cancel/replace the assignment or cancel unfinished TODOs, append replacements, and reactivate explicitly. Preserve completed evidence. Dependencies cannot be edited and cancelled prerequisites do not unlock dependents; replace affected downstream plans when needed. No terminal reopening, age-based reclaim, nested delegation, or original-worker affinity. Escalate product/authority decisions to CoS with a recommendation.
