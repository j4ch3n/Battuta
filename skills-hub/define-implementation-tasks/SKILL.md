---
name: define-implementation-tasks
description: Use when translating an approved ticket into bounded technical assignments for implementation agents.
---

# Define implementation tasks

## Objective

Turn approved scope into complete, verifiable assignments with safe integration
boundaries and prerequisites.

## Capabilities and boundaries

Read the approved ticket or commission and relevant evidence/code. CoS retains
product scope and authority; Manager plans and assesses technical work; workers
claim whole assignments. These roles do not prescribe the invoker. This skill
defines assignment content, not a new scheduler, per-TODO ownership graph, or
execution authority.

## How and why

Determine the smallest complete solution, integration boundaries, acceptance
checks, and existing assignment prerequisites. Use todo to create each assignment
with its complete initial TODO batch atomically, not create-then-append initial
planning. Include explicit project, authority, inputs, expected deliverables,
verification, and decisions workers must raise.

Make the brief self-contained: specify what must change, what must not change,
and how success is checked. Include exact checkout and input document paths,
especially the relevant PRD/version, with enough context to interpret them. Resolve
consequential product gaps with CoS before handing affected execution to a worker.
Do not require workers to discover project context or infer the requested outcome.

Allow multiple open assignments, but sequence conflicting workspace changes through immutable dependencies. Workers claim whole assignments and execute their TODOs sequentially; do not plan per-TODO ownership or a TODO graph. Manager remains available for asynchronous results and evidence assessment. Keep product scope/authority decisions with CoS; use explicit blocked-work recovery rather than routine execution-status edits.

For example, assign “add validated import retry with focused checks” with the
affected boundary and integration verification. Avoid “edit parser.ts” as a
standalone task. **Why:** outcome-based acceptance makes independent work
reviewable and dependencies prevent conflicting changes.
