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

## Choose a worker capability

Identify the outcome, the tools it actually needs, and the
authority for any external action. Capabilities route work; they do not grant
permission to publish, interact, or access an account or device.

| Mission | Requirement | Available functions |
| --- | --- | --- |
| General research or other non-mobile work | `research` | The general worker can research with web access, use a browser, and use `delegate` for coding, planning and review. Use it for investigation, analysis, and other work that does not require a phone. |
| Work on an authorized Android device | `mobile-control` | The influencer worker can control the phone and access the web. Use it to browse apps, prepare content, or, only when explicitly authorized, post or reply. |

With todo, omit `require_abilities` for the default
`["research"]`; explicitly set `["mobile-control"]` for phone work. The
influencer worker has a research skill, but does not advertise the `research`
routing ability. `mobile` is not an ability name.

Before creating the assignment, check that a worker can satisfy every required ability. The current
profiles do not advertise both, so split mixed research and phone work into
separate assignments with prerequisites and handoff evidence rather than
requiring both on one assignment. Specify the authorized device, accounts,
permitted actions, inputs, and expected evidence for phone work. If the required
worker, device, access, or authority is unavailable, surface the blocker rather
than routing to an incompatible worker or expanding permission.

## Choose a difficulty

Set `difficulty` on every assignment; it is your advice on how demanding the work
is, and the worker decides which model to use. Omitting it means `easy`. Judge by how much uncertainty and judgment the work needs, not by
its topic or size. A stronger model costs more, so use the lowest level that can
finish the work reliably.

- `easy`: the path is known and the result is easy to check. Examples: bulk data
  curation, a simple single-module feature, a bug with a known cause, a
  reproducing test and a single-module fix.
- `medium`: the worker must investigate or decide before acting. Examples: a bug
  whose cause is not yet identified, multi-step research.
- `hard`: the work spans boundaries or fails in non-obvious ways. Examples:
  cross-module or schema changes, failures a medium attempt could not explain.
- `hail_mary`: a last resort after a `hard` attempt failed.

When a worker is blocked or unable, replan one level up with the blocker as
context; do not skip levels. Reviews of diffs, tests and results are
assignments too, and use the same reasoning.

## State the work type and review focus

Every assignment names one work type: plan, research, implement or review. The
worker runs it through its own tools and does not execute it directly. Write the
objective and acceptance so a separate reviewer can pass or fail each one.

A review assignment names exactly one focus and its pass condition. Other focuses
are separate assignments, and the author never reviews its own work.

| Focus | Question | Reviewer needs |
| --- | --- | --- |
| Spec compliance | Does it do what the brief and PRD asked, nothing missing or extra? | Brief, PRD, acceptance, diff |
| Correctness and quality | Is it correct, tested and maintainable? | Diff and tests |
| Verification | Does it run and pass the stated checks? | The checks to run and expected results |
| Risk and integration | Does the whole milestone fit the system and break nothing else? | Full milestone, neighbouring code |

Scale review to risk: verification alone for trivial work; spec compliance plus
correctness for normal work; add risk and integration for hard or cross-boundary
work. End each milestone with its reviews as assignments that depend on the work
they judge. Read the returned evidence yourself; do not repeat the review.

A failed review becomes a new implement assignment, one difficulty level up with
the findings as context, then a fresh review of the same focus. Do not reopen the
old assignment. After a few cycles without progress, escalate to CoS with a
recommendation.

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

If any deliverable is an artifact (an HTML page, report, deck, website, or anything
to be published or shared), the brief must name the `artifacts` skill and its steps:
init with a vendor, author in the returned draft, artifact-review, publish only if the
owner has authorised that artifact, then verify local_url. It must not ask for a
standalone or self-contained HTML file as the deliverable, and must not copy a file
over a generated index.html. Verification items must say: verify local_url; report
the public URL.

Allow multiple open assignments, but sequence conflicting workspace changes through immutable dependencies. Workers claim whole assignments and execute their TODOs sequentially; do not plan per-TODO ownership or a TODO graph. Manager remains available for asynchronous results and evidence assessment. Keep product scope/authority decisions with CoS; use explicit blocked-work recovery rather than routine execution-status edits.

For example, assign “add validated import retry with focused checks” with the
affected boundary and integration verification. Avoid “edit parser.ts” as a
standalone task. **Why:** outcome-based acceptance makes independent work
reviewable and dependencies prevent conflicting changes.
