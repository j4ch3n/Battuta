# Messages to `manager`

Select the message that advances the commission. CoS is the product-authority
source of intent, constraints, acceptance, and the result needed; `manager` owns
substantive investigation, breakdown, planning, and execution/coordination.
This route description does not limit who may use the template. Read one template;
adapt its JSON rather than sending fictional evidence unchanged.

| Situation                                            | Template                                              | Expected next step                                              |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Feasibility or scope is unresolved                   | [Request assessment](request-assessment.md)           | Evidence, alternatives, smallest useful milestone, and unknowns |
| Substantive work has confirmed execution authority | [Commission work](request-assessment.md#authorized-work-example) | Manager plans and executes/coordinates within the mandate, returning verification and decisions needed |
| Manager needs a product ambiguity resolved                | [Clarify product scope](clarify-product-scope.md)     | Assess or continue from the referenced current spec             |
| Changed scope affects active work or its next action | [Provide updated context](provide-updated-context.md) | Apply the boundary or pause the affected work                   |
| A changed requirement invalidates an assumption      | [Request reassessment](request-reassessment.md)       | Reassess only the affected technical question                   |

## Before sending

Use the `project-context` skill when resolving current artifact locations. Lead with the action needed; retain detailed evidence in referenced artifacts. Include every content field, using `[]`/`null` for unused sections. A non-null `request` needs a reply expectation. The response window is not an implementation deadline.

For replies, copy the actual incoming `message_ref` into `parent`; sample UUIDs/IDs are illustrative. One direct reply is allowed per message. After a progress reply, later mail is a new send with `related_messages`.

CoS saves complete spec versions and records go/no-go with rationale using the authoring and decision tools available to CoS. Use the `project-context` skill for managed document authoring and the `project-management` skill when deciding product scope or go/no-go. A recorded decision alone does not require mail. Outstanding requests still need answers, and affected active work needs actionable context.
