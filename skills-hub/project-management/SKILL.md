---
name: project-management
description: Use when discovering or initializing projects, inspecting or authoring project documents, planning delivery, coordinating commitments and dependencies, reviewing progress, recovering slipping work, or closing accepted outcomes.
metadata:
  source: https://github.com/magnus919/agent-skills/blob/main/technical-project-management/SKILL.md
---

# Project management

## Objective and boundaries

Maintain a coherent project from its registered context and requirements through
credible delivery commitments, evidence-backed review, and accepted handover.
Start at the current task or decision; do not restart a healthy project.

CoS decides high-level intent, scope, priorities, and product acceptance within
the owner's mandate. Manager develops complementary requirements, technical
detail, executable briefs, and delivery recommendations. Questions that change
product intent go to `cos`; CoS asks the owner when confirmed context and its
mandate cannot establish the answer. These are authority and recipient roles,
not invoker restrictions; loading this skill grants no tools or permissions.

`battuta-project` owns project metadata, discovery, checkout context, summaries,
repository guidance, and GitHub/Linear association. Project-spec tools own managed
document inventory, immutable versions, canonical reviews, and decisions. Linear
tools own issues/cycles; assignment tools own commissioned work. The lifecycle
connects these operations without turning the CLI into a task runner or granting
execution authorization.

## First move

Resolve the explicit project and read existing artifacts and relevant Linear
records before asking questions. Identify the outcome, phase, next decision,
authority, constraints, and evidence gaps. Ask only about gaps that affect the
next action. For an established project, lead with the delta, options,
recommendation, and decision needed. Ordinary conversation needs no project.

## Lifecycle and operations

Read the relevant [command reference](references/commands.md) section before CLI
operations; it owns syntax, outputs, validation, side effects, and failure/recovery.
Run from any directory, naming each project explicitly; there is no shared current
project. Read only the references required by the current situation.

| Situation | Operations and workflow | Observable result |
| --- | --- | --- |
| Discover or initialize | Use CLI `list`, `explain <project-name>`, or authorized `init`; use [GitHub linking](references/commands.md#link-github-later) and [Linear association](references/commands.md#linear-projects) for metadata. Read [engagement and initiation](references/engagement-and-initiation.md) for an unclear mandate. | Explicit project, checkout, summary, linked records, and authority gaps; initialization creates a summary skeleton, not completed requirements |
| Establish or refine scope | Use `inspect_specs` and `describe_spec` for authoritative documents; select the document responsibility below. Use the [product-decision workflow](references/product-decisions.md) for go/no-go/refine. | Reviewable requirements and an attributed decision or consequential question for CoS |
| Prepare delivery | Develop complementary PRD detail, plans, tasks, and canonical checklist/review through [project-spec tools](references/spec-tools.md). Assess uncertainty with [adaptive delivery](references/adaptive-delivery.md). | Explicit versions, readiness evidence, acceptance, exclusions, dependencies, and executable briefs |
| Commission and coordinate | Inspect/reuse Linear records. Commission Manager to prepare assignments, or use ticket-writing, define-assignments, todo, and coordinate-workers for commissioned planning. Use [dependency/handoff guidance](references/hybrid-and-dependencies.md). | Authorized assignments with ordered work, input paths, non-conflicting boundaries, and accountable dependencies |
| Review or recover | Compare evidence with commitments using [control and communication](references/control-and-communication.md); use [change and recovery](references/change-and-recovery.md) for slips or scope conflicts. | Honest progress, recovery options, affected commitments, and an accountable next decision |
| Close or hand over | Use [closure and transition](references/closure-and-transition.md); distinguish accepted results from finished TODOs. | Acceptance evidence, carryovers, and explicit residual ownership |

Do not call a proposed cycle an active cycle, an approved issue a cycle commitment, a desired date a commitment, or a diagnostic brief an approved plan. Before proposing a commitment, identify who can authorize scope, dates, capacity, acceptance, and external communication. Mark each as accepted, proposed, unknown, or disputed. Read-only diagnosis may proceed; changes to cycle membership or other commitments require the user's approval.

## Operating loop

1. Establish mandate and authority; separate approved issues and commitments, forecasts, assumptions, and unknowns. A diagnostic or options brief can precede approval; do not turn it into an approved implementation plan.
2. Select the smallest adequate management approach. Preserve effective existing practices and specify any changed decision rights, cadence, and handoffs.
3. Reuse existing project plans and Linear records. Maintain cycle goals, issue status, dependencies, remaining work, availability, risks, blockers, and decisions. Check for duplicate or completed work before proposing new issues. Give each Worker an explicit project, commissioned checkout, relevant PRD/version and input paths, ticket reference with needed content, exclusions, acceptance, and authority. Workers follow the brief, not an inferred mandate.
4. Compare evidence with the agreed goal and commitments. Investigate contradictions; missing evidence means unknown, not green. Surface material changes promptly.
5. Present feasible options when scope, capacity, cost, or dates conflict. Keep the history of previous commitments; an authorized change does not erase prior variance. Route high-level outcome, scope, and priority decisions to CoS within the owner's mandate. Develop complementary requirements and technical detail inside those boundaries; return product-changing choices to CoS. Cycle membership changes require owner approval; start a cycle only when the user explicitly says to start it.
6. Close only on accepted outcomes and explicit residual ownership. Distinguish cycle close, project closure, release readiness, service operation, and later benefit realization.

## Document responsibilities

Select only the requested responsibility; read its prompt and template when
provided. These are document methodologies, not automatic lifecycle gates.

| Entry | Purpose and result |
| --- | --- |
| [Summary](references/summary/prompt.md) | Project-wide purpose, users, scope, current capabilities and spec links in `SUMMARY.md` |
| [Specify](references/specify/prompt.md) | Feature requirements, scenarios and outcomes in a named versioned spec |
| [Clarify](references/clarify/prompt.md) | Resolve ambiguity in a complete new requirements version |
| [Plan](references/plan/prompt.md) | Technical design, including needed research, data models, contracts and quickstarts |
| [Tasks](references/tasks/prompt.md) | Concrete ordered work traceable to the design |
| [Checklist](references/checklist/prompt.md) | Canonical requirements-quality checklist |
| [Analyze](references/analyze/prompt.md) | Read-only consistency and coverage findings across documents |
| [Constitution](references/constitution/prompt.md) | Adopted project-wide principles in the canonical versioned `Constitution` |

Commission substantial drafting to Manager, or use prd for requirements and
draft-writing for prose when performing that commissioned work. Use research for
investigation. This skill provides project lifecycle and document integration,
not competing specialist workflows. CoS persists complete
immutable document versions and terminal go/no-go with rationale. Manager authors
substantive detailed content and saves only its canonical checklist/review through
its tools. Use the [metadata contract](references/spec-metadata.md) for returned
details; do not patch managed files or JSON directly. Refinement creates a new
version while open. No saved document or product decision authorizes execution.

## Workspace binding

This binding overrides upstream runtime assumptions in imported prompts/templates;
it supplies locations and invocation context, not a replacement methodology.

1. Use CLI `list` for discovery and `explain <project-name>` for the intended
   project's checkout, summary, and repository guidance. Read applicable
   README/AGENTS files and supplied relevant context. Ask which project/feature
   when ambiguous; do not infer ownership from the current directory.
2. Resolve document inventories with `inspect_specs` and named versions/content
   with `describe_spec`. Use returned references rather than assumed layout.
   Preserve existing unregistered files; do not silently import them. A supplied
   worktree remains the commissioned execution checkout after verifying its
   relationship to the registered repository.
3. The current natural-language request supplies `$ARGUMENTS`, `{ARGS}`, and
   “User Input.” Slash-command spellings and `__SPECKIT_COMMAND_<NAME>__` tokens
   name document responsibilities, not required user syntax or shell commands.
   Implementation, convergence, and issue conversion are not active entries.
4. Read the selected prompt and any `template.md`, but persist full managed outputs
   through the owning role's tools. CoS creates immutable named versions; Manager
   fully replaces the single canonical checklist/review. Both roles use
   `read_constitution`; CoS uses `init_constitution`/`update_constitution` for
   complete canonical versions. The summary can use ordinary file tools at the
   CLI-reported location. Do not install Spec Kit, initialize its infrastructure,
   or create shared current-feature state.

| Upstream name/path | Runtime reference |
| --- | --- |
| `FEATURE_DIR`, `SPECIFY_FEATURE_DIRECTORY` | Named spec directory returned by `describe_spec` |
| `SPEC_FILE`, `FEATURE_SPEC`, `SPEC` | Explicit immutable product-spec version |
| `IMPL_PLAN`, `PLAN` | Explicit version of a separately named technical plan |
| `TASKS` | Explicit version of a separately named task document |
| Constitution | Canonical document through `read_constitution`; an empty scaffold is not policy |
| Document references | Actual named versions/artifacts returned by spec tools |
| Source/repository root | Verified commissioned checkout, otherwise the CLI-reported repository checkout |
| Template resolver output | Selected responsibility's shared `template.md` |

Use absolute file paths and relative artifact links. State the checkout root for
source-relative plans/tasks. Do not create or switch branches merely to author
documents. Replace command tokens/placeholders with real artifact references.
Evaluate prerequisites from actual artifact content, not command history. Report
stale/missing documents, including tasks inconsistent with an updated plan; do
not silently regenerate them during review. Use available research tools; when
delegation is unavailable, investigate inline rather than installing a runtime.

**Inactive upstream integration sections:** do not execute Pre-Execution Checks,
Mandatory Post-Execution Hooks, Post-Execution Checks, “Check for extension hooks,”
or hook-related Done When items. Retained `EXECUTE_COMMAND` markers and optional
branch-hook steps are reference text only. No hooks, registries, preset layers,
or `.specify/` helper scripts participate in this runtime.

Initialization creates a summary skeleton, not adopted principles or spec storage.
Older registrations may lack artifacts: `explain` stays read-only, while requested
authoring creates only what is needed. Complete the summary from confirmed
conversation and repository evidence, not guessed product context. CoS supplies
prepared relevant memory; Manager asks CoS for missing/stale context. Project
facts retain explicit membership/qualifications; personal owner understanding is
separate and grants no authority. Workers return essential gaps through their
assignment. There are no project-local memory files or conversational checkout
bindings.

## Authority and completion

CoS makes go/no-go/refine product decisions within the owner's mandate under AGENTS.md. It does not invent stakeholder consent, execution authorization, or cycle commitments. Apply existing authorization without asking repeatedly for the same scope. Keep drafts distinct from issued communications. Do not monitor people or turn activity counts into individual performance judgments.

For a feasibility/scope assessment, prepare the evidence and recommendation using
the product-decision workflow above; CoS establishes and records the decision
through its authorized tools. Mail to Manager is only for additional context or a
needed action, not a required decision announcement.

For bounded issue authoring, use ticket-writing when doing the commissioned work,
or commission Manager to prepare it. Route technical assessment requests to
`manager` and results/product questions to `cos` using the corresponding
communication skill. TODO completion is not acceptance of a delivery milestone.
Bound execution uses execute-assignment; note-taking and artifact production use
their respective skills. Return outcomes through the originating conversation;
CoS's owner-facing summaries should not dump document templates.

For example, report a slipping cycle with evidence-backed scope/date tradeoffs and
an accountable next decision. Avoid treating an approved issue or forecast as a
commitment. **Why:** explicit acceptance and retained variance prevent misleading
green reports.

For document work, resolve the named version before reading or saving. Avoid
writing a managed spec directly or treating another directory as the project.
**Why:** explicit references preserve project/version boundaries and tool-managed
persistence.

Complete a requested review when the update is delivered, claims have evidence or explicit uncertainty, and unresolved decisions have an accountable route and next review trigger. Do not imply ongoing monitoring without an authorized mechanism.

## Sources

Delivery references use the local [source index](references/source-index.md).
The seven specification responsibilities preserve Spec Kit 1.0.13 wording with
documented adaptations; retain [attribution and notices](references/attribution.md).
