---
name: ticket-writing
description: Use when creating or substantially rewriting a Linear ticket, or organising tickets through project placement, sub-issues, dependencies, related work, or duplicates.
---

# Ticket writing and organisation

Write a bounded outcome that the owner and engineering can understand and verify. Organise it so its place in the work is explicit. Use the existing Linear MCP; follow the authority and communication rules in AGENTS.md.

## Inspect existing work

Read the relevant project and cited issues before drafting. Search for overlapping or completed work; update an existing ticket rather than creating a duplicate when it already owns the outcome. Establish the intended user, desired change, scope, and material constraints from the request and current evidence. Ask only about gaps that affect the outcome or organisation, not routine template fields.

## Write the ticket

Use the smallest structure that makes the work clear. Prefer an action-and-outcome title, a direct opening, and observable acceptance conditions. Add headings when they help; do not force every ticket into identical sections.

- **Title:** name the change and outcome, not a topic.
  - Bad: “Export improvements.”
  - Good: “Let owners export the filtered transaction list.”
  - Why: the second names a bounded capability instead of an unspecified improvement.
- **Opening:** explain the need, impact, and requested change without requiring another document.
  - Bad: “We investigated several logs and discussed possible retry strategies. See the thread.”
  - Good: “A failed export loses the owner's selected filters. Preserve those filters so they can retry without rebuilding the selection.”
  - Why: the second makes the problem and intended correction immediately visible.
- **Acceptance:** describe observable outcomes. Use “Acceptance criteria” when a dedicated section helps; do not require “Done when,” user stories, or Given/When/Then phrasing.
  - Bad: “Exports are reliable and well tested.”
  - Good: “After a failed export, retry uses the same filters and date range.”
  - Why: the second tells a reviewer what behaviour to check, without inventing a test result.
- **Evidence and uncertainty:** distinguish observed behaviour from an unconfirmed cause.
  - Bad: “The worker leaks memory and crashes.”
  - Good: “The export stopped before producing a file. The cause is unconfirmed; investigate the worker failure and report the finding.”
  - Why: the second preserves the observation without presenting a hypothesis as fact.

These are illustrative fragments, not facts to insert into another ticket. For bugs, retain essential reproduction steps, expected versus actual behaviour, and affected conditions. For features, identify who gains what capability and its boundaries. Leave routine implementation choices to engineering; include a technical constraint when it is established and consequential.

An ordinary ticket often fits in 150–250 words with 3–5 short acceptance checks. These are guides, not limits. Keep essential uncertainty, safety/privacy restrictions, and requirements in the description. Link detailed investigation, logs, and plans instead of copying their history. Add exclusions, dependencies, or open questions only when they change the work. Remove repeated caveats, ceremonial prose, and routine authorisation disclaimers; never invent approval, cause, or successful verification.

## Organise the work

Use Linear MCP to place the ticket in the appropriate project and maintain native relationships. A description link provides context; it does not establish a relationship in the tracker.

| Relationship        | Use when                                                                                 | Avoid                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Parent/sub-issue    | The child delivers a bounded part of the parent's outcome.                               | Making every contextual reference a parent.                     |
| Related             | Separate work has a meaningful connection but neither is a prerequisite.                 | Treating shared subject matter alone as a dependency.           |
| Blocking/blocked by | One outcome genuinely cannot proceed without another. State which work depends on which. | Inferring a blocker from mention order or preferred sequencing. |
| Duplicate           | An existing ticket already owns the same underlying work.                                | Treating similar symptoms as proof of the same cause or scope.  |

**Bad:** “See the export redesign ticket; blocked by it.”
**Good:** Relate an independently deliverable export fix to the redesign. Make the redesign a blocker only if the fix actually requires its outcome.
**Why:** connection is not dependency; native edges must reflect the intended relationship, not merely the wording of a reference.

Split work when outcomes can be independently accepted; use a parent to retain the shared objective. Do not split a small task into implementation-layer chores merely to create more tickets. Ask when the relationship is materially ambiguous; do not link every mentioned issue automatically.

Preserve existing metadata and unrelated relationships during rewrites. Set labels, assignee, priority, status, dates, or cycle membership only when supported by the request or established context and authority. Do not replace an existing parent casually, create duplicate links on repeated updates, or bulk-change historical tickets without approval. Use the `project-management` skill for broader delivery coordination.

## Save and verify

Use current Linear MCP tool descriptions for invocation details, making the narrowest authorised changes. Create native relationships rather than relying on prose links. Apply the existing mandate without asking for the same approval repeatedly; keep proposed drafts distinct from saved work.

Read back the saved description, parent, relationships, and any changed metadata before reporting success. If a save times out or its result is uncertain, inspect current state before retrying; do not blindly create another ticket or repeat an additive update. Report failed or unverified changes separately from confirmed ones.

## Final checklist

Before saving:

- Does the title and opening explain the outcome and impact without a research diary?
- Are acceptance conditions observable, with all material requirements retained?
- Are evidence, uncertainty, scope boundaries, and safety constraints honest and visible?
- Have repetition, generic disclaimers, and unsupported implementation prescriptions been removed?
- Have overlap/completion, project placement, and intended relationships been checked?
- Will the update preserve unrelated metadata and relationships, with dependencies pointing the right way?

After saving: read back the issue and verify its content and organisation. Report the issue identifier/link and confirmed changes; state any remaining failure or uncertainty accurately.
