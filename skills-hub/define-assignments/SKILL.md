---
name: define-assignments
description: Use when translating an authorized commission into bounded assignments for discovery, production, implementation or verification.
---

# Define assignments

## Objective

Turn approved scope into complete, verifiable assignments with safe integration
boundaries and prerequisites.

## Capabilities and boundaries

Read the approved ticket or commission and relevant evidence/code. CoS retains
product scope and authority; Manager plans and assesses technical work; workers
claim whole assignments. These roles do not prescribe the invoker. This skill
defines assignment content, not a new scheduler, per-TODO ownership graph, or
execution authority.

## Flight manual: choose a worker capability

**Preflight:** Identify the outcome, the tools it actually needs, and the
authority for any external action. Capabilities route work; they do not grant
permission to publish, interact, or access an account or device.

| Mission | Requirement | Available functions |
| --- | --- | --- |
| General research or other non-mobile work | `research` | The general worker can research with web access, use a browser, and delegate to researcher and reviewer subagents. Use it for investigation, analysis, and other work that does not require a phone. |
| Work on an authorized Android device | `mobile-control` | The influencer worker can control the phone and access the web. Use it to browse apps, prepare content, or, only when explicitly authorized, post or reply. |

**Set course:** With todo, omit `require_abilities` for the default
`["research"]`; explicitly set `["mobile-control"]` for phone work. The
influencer worker has a research skill, but does not advertise the `research`
routing ability. `mobile` is not an ability name.

**Before dispatch:** A worker must satisfy every required ability. The current
profiles do not advertise both, so split mixed research and phone work into
separate assignments with prerequisites and handoff evidence rather than
requiring both on one assignment. Specify the authorized device, accounts,
permitted actions, inputs, and expected evidence for phone work. If the required
worker, device, access, or authority is unavailable, surface the blocker rather
than routing to an incompatible worker or expanding permission.

## How and why

Plan the next useful milestone from current evidence. When discovery is needed,
make it a bounded assignment first, then use its findings to shape later work.
A complete assignment is not a complete prediction of the whole project.

Determine the milestone's outcome, integration boundaries, acceptance
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
