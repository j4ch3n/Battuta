---
name: prd
description: Use when a substantial initiative needs reviewable product requirements connecting the problem, users, scope, measures, and acceptance; not for a small task.
license: CC-BY-NC-SA-4.0
metadata:
  source: https://github.com/deanpeters/product-manager-prompts/blob/c3b91dba8f7782fac72c7aa340b98d6554b1f3ec/workshops/prd-workshop.md
---

## Objective

Produce reviewable requirements that connect the problem, users, scope, success
measures, and acceptance while distinguishing assumptions from decisions.

## Capabilities and boundaries

Use the supplied template or the fallback below to draft requirements. CoS retains
product decisions and managed-document persistence authority; consequential gaps
go to CoS. A bound assignment uses confirmed requirements and reports unresolved
consequential gaps through execute-assignment. This skill does not invent approval
or make a participant interaction mandatory for commissioned work.

## Choose the mode

Co-author section by section when a participant is actively refining the PRD.
For a commissioned or bound task, complete the requested sections from the
confirmed inputs and label assumptions/open questions without pausing for each
section. This depends on task context, not the role of the invoking agent.

Check whether a PRD template is already available in the session or
attached. The template may be a PDF, Markdown file, Word document,
screenshot, outline, or rough structure.

If no PRD template is available, ask for it. If the user does not
have one, offer this canonical fallback structure and use it as the
working template:

1. Executive Summary (problem + solution + impact, one paragraph)
2. Problem Statement (who, what, why painful, evidence)
3. Target Users & Personas (primary, secondary, jobs-to-be-done)
4. Strategic Context (business goals, market opportunity,
   competitive landscape, why now)
5. Solution Overview (description, user flows, key features)
6. Success Metrics (primary, secondary, current -> target)
7. Requirements (user stories, acceptance criteria, constraints)
8. Out of Scope (what we are explicitly not building)
9. Open Questions & Risks

### Focused user outcome (optional)

When it improves clarity, include the persona, desired outcome, and optional
Given/When/Then acceptance checks within the PRD. This is a section, not a
separate artifact or required stage.

Once you have a template, use its major sections as the working structure.

## Task

Build the PRD one section at a time using:

- the provided PRD template
- the product context or case study
- the current session context
- any team notes or prior output
- web searches you run to fill in missing information

Where information is missing, run a web search. Label remaining gaps
explicitly as **Assumption** or **Open Question**. Do not invent facts,
data, approvals, or commitments.

## How to Work

In interactive co-authoring, after completing each section, stop and ask:

> "Want to refine this section, or move on to **[next section name]**?"

Wait for the response before continuing.

If the user says "just keep going," or the work is commissioned, complete the
remaining sections without gates, but still label every Assumption and Open Question.

## Finish

After the final section, ask if the user wants the full PRD assembled
into a single document.

Then append a closing self-critique:

- Strongest section
- Weakest section
- Top assumptions to validate
- Recommended next step

### Assumptions to Validate

- [Assumption 1]
- [Assumption 2]
- [Assumption 3]

## Final Step

Offer exactly 4 next options:

1. Generate a validation plan for the top assumptions (Recommended)
2. Draft a focused user outcome with acceptance checks from the PRD scope
3. Create a one-page executive summary for stakeholder review
4. Stress-test the PRD with a premortem on the launch

Ask the user to reply with `1`, `2`, `3`, `4`, `1 and 3`, or a custom
path.

## Why and examples

State a measurable requirement with its affected user, acceptance condition, and
explicit assumption. **Why:** a reviewer can distinguish an agreed outcome from a
hypothesis. Avoid “make it better” or treating a commissioned draft as product
approval; both hide the decision that still needs an authorized owner.
