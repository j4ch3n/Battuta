# PM → TL templates

Select the message that advances the current technical question. Read one template; the JSON is a complete tool argument example, not an instruction to send unchanged.

| Situation                                            | Template                                              | Expected next step                                              |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Feasibility or scope is unresolved                   | [Request assessment](request-assessment.md)           | Evidence, alternatives, smallest useful milestone, and unknowns |
| TL needs a product ambiguity resolved                | [Clarify product scope](clarify-product-scope.md)     | Assess or continue from the referenced current spec             |
| Changed scope affects active work or its next action | [Provide updated context](provide-updated-context.md) | Apply the boundary or pause the affected work                   |
| A changed requirement invalidates an assumption      | [Request reassessment](request-reassessment.md)       | Reassess only the affected technical question                   |

## Before sending

Use current artifact locations from project-context. Lead with the action needed; retain detailed evidence in referenced artifacts. Include every content field, using `[]`/`null` for unused sections. A non-null `request` needs a reply expectation. The response window is not an implementation deadline.

For replies, copy the actual incoming `message_ref` into `parent`; sample UUIDs/IDs are illustrative. One direct reply is allowed per message. After a progress reply, later mail is a new send with `related_messages`. The live tools expose the maintained [Agent Mail tool contract](../../../../../../../agent-mail/schemas.ts).

PM persists full spec versions and terminal go/no-go through the [product decision workflow](../../../project-management/references/product-decisions.md). A recorded decision alone does not require mail. Outstanding requests still need answers, and affected active work needs actionable context.
