---
name: project-management
description: Use when planning or reviewing project delivery, coordinating commitments, cycles, dependencies and handoffs, assessing readiness, recovering slipping work, or closing accepted outcomes.
metadata:
  source: https://github.com/magnus919/agent-skills/blob/main/technical-project-management/SKILL.md
---

# Project management

## Objective and boundaries

Produce a credible delivery decision or update with evidence, explicit
commitments, authority, and residual ownership. The skill supports delivery
judgement and coordination, not requirements templates, research methodology,
working-material commands, or presentation construction. CoS, Manager, and owner
describe authority and audiences; loading this skill grants none of their powers.

Help a team make and maintain credible delivery commitments. Start at the user's current decision; do not restart a healthy project or impose a new methodology. Follow the approval and cycle-start rules in AGENTS.md.

## First move

Read existing project artifacts and Linear projects, issues, and cycles before asking questions. Identify the outcome, current phase, immediate decision, decision-maker, constraints, and evidence gaps. Ask only about gaps that affect the next decision. For an established project, lead with the delta, options, recommendation, and decision needed.

### Choose the entry point

| Starting condition                                           | First action                                                              | Primary output                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------- |
| New or inherited project with unclear mandate                | Read [Engagement and initiation](references/engagement-and-initiation.md) | Proposed brief with authority and evidence gaps    |
| Approved work with weak control, or a material risk or issue | Read [Control and communication](references/control-and-communication.md) | Current control record and decision brief          |
| Slipping scope, cycle goal, or dependency                    | Read [Change and recovery](references/change-and-recovery.md)             | Recovery options and affected commitments          |
| Cross-team or supplier handoff                               | Read [Hybrid and dependencies](references/hybrid-and-dependencies.md)     | Dependency agreement and acceptance evidence       |
| Cycle ending or work being handed over                       | Read [Closure and transition](references/closure-and-transition.md)       | Delivered work, carryovers, and accepted ownership |
| Technical uncertainty needs staged learning                  | Read [Adaptive delivery](references/adaptive-delivery.md)                 | Evidence-backed next learning or delivery decision |

Do not call a proposed cycle an active cycle, an approved issue a cycle commitment, a desired date a commitment, or a diagnostic brief an approved plan. Before proposing a commitment, identify who can authorize scope, dates, capacity, acceptance, and external communication. Mark each as accepted, proposed, unknown, or disputed. Read-only diagnosis may proceed; changes to cycle membership or other commitments require the user's approval.

## Operating loop

1. Establish mandate and authority; separate approved issues and commitments, forecasts, assumptions, and unknowns. A diagnostic or options brief can precede approval; do not turn it into an approved implementation plan.
2. Select the smallest adequate management approach. Preserve effective existing practices and specify any changed decision rights, cadence, and handoffs.
3. Reuse existing project plans and Linear records. Maintain cycle goals, issue status, dependencies, remaining work, availability, risks, blockers, and decisions. Check for duplicate or completed work before proposing new issues.
4. Compare evidence with the agreed goal and commitments. Investigate contradictions; missing evidence means unknown, not green. Surface material changes promptly.
5. Present feasible options when scope, capacity, cost, or dates conflict. Keep the history of previous commitments; an authorized change does not erase prior variance. Route high-level outcome, scope, and priority decisions to CoS within the owner's mandate. Develop complementary requirements and technical detail inside those boundaries; return product-changing choices to CoS. Cycle membership changes require owner approval; start a cycle only when the user explicitly says to start it.
6. Close only on accepted outcomes and explicit residual ownership. Distinguish cycle close, project closure, release readiness, service operation, and later benefit realization.

## Reference routing

Read only what the current task requires. The local references contain applicability, procedures, failure signals, and observable exits. Their source IDs refer to the local [source index](references/source-index.md).

| Decision phase / situation                       | Read                                                                 | Exit artifact or evidence                        |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------ |
| New or inherited project                         | [Engagement and initiation](references/engagement-and-initiation.md) | Mandate, authority, evidence gaps                |
| Scrum, cycles, incremental delivery, uncertainty | [Adaptive delivery](references/adaptive-delivery.md)                 | Learning or increment evidence and next decision |
| Cross-team or vendor interfaces                  | [Hybrid and dependencies](references/hybrid-and-dependencies.md)     | Dependency and handoff acceptance                |
| Progress, risks, stakeholder disagreement        | [Control and communication](references/control-and-communication.md) | Update or decision brief with next checkpoint    |
| Scope changes or troubled work                   | [Change and recovery](references/change-and-recovery.md)             | Decision preserving prior commitments            |
| Acceptance or operational handoff                | [Closure and transition](references/closure-and-transition.md)       | Closure or transition with residual owners       |

## Authority and completion

CoS makes go/no-go/refine product decisions within the owner's mandate under AGENTS.md. It does not invent stakeholder consent, execution authorization, or cycle commitments. Apply existing authorization without asking repeatedly for the same scope. Keep drafts distinct from issued communications. Do not monitor people or turn activity counts into individual performance judgments.

For a feasibility/scope assessment, use the [product decision workflow](references/product-decisions.md). Prepare the evidence and recommendation; CoS establishes the high-level product decision and rationale. Use the project-context skill to inspect and persist canonical documents through the authorized tools. Mail to Manager is only for additional context or a needed action, not a required decision announcement.

This skill owns delivery judgement and coordination, not research methodology,
requirements templates, working-material commands, or presentation construction.
For bounded issue authoring, use ticket-writing when doing the commissioned work,
or commission Manager to prepare it. Route technical assessment requests to
`manager` and results/product questions to `cos` using the corresponding
communication skill. TODO completion is not acceptance of a delivery milestone.

For example, report a slipping cycle with evidence-backed scope/date tradeoffs and
an accountable next decision. Avoid treating an approved issue or forecast as a
commitment. **Why:** explicit acceptance and retained variance prevent misleading
green reports.

Complete a requested review when the update is delivered, claims have evidence or explicit uncertainty, and unresolved decisions have an accountable route and next review trigger. Do not imply ongoing monitoring without an authorized mechanism.
