---
name: project-memory
description: Use when prior project decisions, constraints, lessons, evidence, or corrections may inform planning, coordination, or delivery work.
---

# Project memory

Use shared memory to retrieve relevant project and global context, then record
confirmed durable additions or corrections when they will help later work.

## Retrieve context

1. Call `memory_recall` with a self-contained semantic query and/or literal
   keywords. Search all scopes unless the task calls for a specific project.
2. Read the returned evidence text and structured metadata together. Use
   `memory_get` when a result's full record, sources, or history matters.
3. Preserve material qualifications when using or sharing a result.

## Interpret results

- **Confidence** qualifies how well the retrieved evidence supports the result;
  it is not a substitute for current verification when the decision depends on
  it.
- **Project/global scope** identifies where a record applies. Do not infer an
  unnamed project from an active task.
- **Lifecycle status** distinguishes current evidence from superseded, expired,
  rejected, or otherwise limited records.
- **Tags** classify and filter records, including scope, project, and kind.
  They help find context but do not replace the content, sources, or
  counterevidence.

## Maintain durable context

Use supported memory tools to record a confirmed decision, reusable lesson, or
correction with its applicable scope and available evidence. Read an existing
record before correcting, linking, changing metadata, or forgetting it; retain
the returned reference and revision where the operation requires them. A write
is complete only after the service returns its result.

Keep temporary status, raw logs, credentials, and copied canonical documents
out of durable memory.
