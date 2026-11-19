# Report feasibility and scope tradeoffs

Use after answering a CoS assessment brief. Recommend a useful achievement milestone, compare alternatives, identify deferred scope and consequences, and distinguish evidence from uncertainty.

## Agent Mail example

Tool: `reply_agent_message`. This is a **fictional completed assessment**, paired with an illustrative CoS request for scope comparison, deferred scope, and evidence/assumption separation. The research document and conclusions below are hypothetical; replace them with actual inspected evidence before sending.

```json
{
  "parent": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "id": "a7c91e3b4d62"
  },
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "Prefer single-project import as milestone 1; execution feasibility still needs a focused probe.",
    "body": "Observed: the proposal combines single import, bulk processing, retry policy, and live progress (specs/import-feasibility/spec-v1.md#scope-review, hypothetical). Inferred: a single-project outcome gives a smaller acceptance boundary while keeping the core achievement. Milestone 1 is independently testable but users import individually, handle failures manually, and get no live progress; the full proposal gives the whole workflow but adds interacting behaviors to verify first. Recommendation: select the smaller milestone provisionally and treat deferred capabilities as later proposals, not commitments. Unknown: execution limits are unmeasured for the required input size, so a bounded probe is needed before implementation. This assessment does not claim the feature is feasible, implemented, or authorized.",
    "result": {
      "state": "complete",
      "checks": [
        { "req": 1, "result": "passed", "evidence": "specs/import-feasibility/spec-v1.md#scope-review" },
        { "req": 2, "result": "passed", "evidence": "specs/import-feasibility/spec-v1.md#scope-review" },
        { "req": 3, "result": "passed", "evidence": "specs/import-feasibility/spec-v1.md#scope-review" }
      ]
    },
    "related_messages": [
      { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "a7c91e3b4d62" }
    ]
  },
  "reply_expectation": null
}
```

## Adaptation and next step

Cover each requirement of the CoS request by its position, with real evidence. If a required assessment action is unfinished or lacks evidence, report `in_progress` or `blocked` instead. Uncertainty about future implementation can remain after an assessment whose explicit deliverable was identifying that uncertainty. CoS decides and records the scope; no separate decision acknowledgment is needed.
