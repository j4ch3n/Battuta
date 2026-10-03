# Future execution responsibilities

These are preserved ideas, not active project-context workflows. The current collection authors and reviews documents; it does not implement a task runner, convergence loop, or issue synchronizer.

## Implementation checklist handling

From [Spec Kit 1.0.13 implement](https://github.com/github/spec-kit/blob/v1.0.13/templates/commands/implement.md):

> Treat checklist markers as a read-only gate: scan checkbox state, report status, and ask before proceeding when needed; do NOT modify checklist files or markers

An eventual implementation workflow should preserve requirements-review evidence, respect confirmed execution authorization, and verify completed work against its specification and plan.

## Post-implementation convergence

From [Spec Kit 1.0.13 converge](https://github.com/github/spec-kit/blob/v1.0.13/templates/commands/converge.md):

> Include every existing task in the intent inventory, regardless of checkbox state or
> Convergence phase: completion claims are not evidence.

Its gap types are `missing`, `partial`, `contradicts`, and `unrequested`. Preserve task IDs and completion history when proposing traceable remediation. Review actual implementation rather than only comparing documents. The append-only convergence workflow is not currently implemented.

## Task-to-issue traceability

From [Spec Kit 1.0.13 taskstoissues](https://github.com/github/spec-kit/blob/v1.0.13/templates/commands/taskstoissues.md):

> Only create issues for tasks that do not yet have a matching issue.

Future issue conversion needs project + feature + task identity, deduplication, local-to-remote links, and existing issue-approval rules. The upstream workflow targets GitHub; mapping approved local tasks to Linear is separate future integration work, not provided by the project association commands.
