# TL → PM templates

Select the message that answers the current request or presents new evidence. Read one template; adapt the JSON to actual findings and references.

| Situation                                             | Template                                                          | Expected next step                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Assessment supports a product choice                  | [Report assessment](report-assessment.md)                         | PM evaluates scope tradeoffs and records the product decision  |
| Product intent blocks investigation or implementation | [Request product clarification](request-product-clarification.md) | PM resolves the acceptance boundary in the spec                |
| Work is ongoing or its requested result is verified   | [Report progress or result](report-progress-or-result.md)         | Continue a bounded action or return its evidence-backed result |
| Material new evidence affects settled scope           | [Report new evidence](report-new-evidence.md)                     | PM evaluates whether the spec needs refinement                 |

## Before sending

Use current artifact locations from project-context. Include every content field; `[]`/`null` represent unused sections. Use `observed`, `confirmed`, or `inferred` honestly. No evidence means explicit uncertainty, not invented proof. Examples describe a fictional project and must never be reported as real findings.

Copy the incoming `message_ref` into reply `parent`, not `in_reply_to`. A non-null `request` needs a reply expectation. One direct reply is allowed per message; after a progress reply, send the final result as new mail with `related_messages` referencing the original request. The live tools expose the maintained [Agent Mail tool contract](../../../../../../../agent-mail/schemas.ts).

For `complete`, supply accomplishments, no remaining action work, and evidence-backed passing required checks. Copy each original request requirement exactly into `checks.expectation`. Completing an assessment can expose uncertainty about implementation; completing implementation requires its own verification. No mandatory PM-decision acknowledgment or repeated objection is needed.
