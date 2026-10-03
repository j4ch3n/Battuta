# Report feasibility and scope tradeoffs

Use after answering a PM assessment brief. Recommend a useful achievement milestone, compare alternatives, identify deferred scope and consequences, and distinguish evidence from uncertainty.

## Agent Mail example

Tool: `reply_agent_message`. This is a **fictional completed assessment**, paired with an illustrative PM request for scope comparison, deferred scope, and evidence/assumption separation. The research document and conclusions below are hypothetical; replace them with actual inspected evidence before sending.

```json
{
  "parent": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "id": "a7c91e3b4d62"
  },
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Prefer single-project import as milestone 1; execution feasibility still needs a focused probe.",
    "context": [
      "The scope assessment is complete. This does not claim the feature is feasible, implemented, or authorized for execution."
    ],
    "findings": [
      {
        "statement": "The reviewed proposal combines single import, bulk processing, retry policy, and live progress.",
        "basis": "observed",
        "evidence": [
          {
            "locator": "specs/import-feasibility/spec-v1.md#scope-review",
            "note": "Hypothetical inspected proposal inventory and dependency review."
          }
        ]
      },
      {
        "statement": "A single-project outcome provides a smaller acceptance boundary while preserving the core user achievement.",
        "basis": "inferred",
        "evidence": []
      }
    ],
    "options": [
      {
        "description": "Milestone 1: import one project and show a final result.",
        "benefits": ["Provides an independently testable user outcome."],
        "drawbacks": ["Users import individually and handle failures manually; no live progress."]
      },
      {
        "description": "Deliver single import, bulk processing, automatic retries, and live progress together.",
        "benefits": ["Provides the full proposed workflow."],
        "drawbacks": ["Adds interacting behaviors to verify before the first usable outcome."]
      }
    ],
    "recommendation": "Select the smaller milestone provisionally; verify execution limits before implementation. Treat deferred capabilities as later proposals, not commitments.",
    "request": null,
    "result": {
      "state": "complete",
      "accomplished": [
        "Compared scope alternatives and documented a milestone recommendation with evidence limits."
      ],
      "remaining": [],
      "checks": [
        {
          "expectation": "Compare a smaller milestone with the full proposal.",
          "required": true,
          "result": "passed",
          "explanation": "Compared single-project import with the complete proposed workflow.",
          "evidence": [
            {
              "locator": "specs/import-feasibility/spec-v1.md#scope-review",
              "note": "Hypothetical comparison of scope alternatives."
            }
          ]
        },
        {
          "expectation": "Identify the achievement, deferred scope, and consequences of deferral.",
          "required": true,
          "result": "passed",
          "explanation": "Identified the final import outcome, deferred features, and manual handling consequences.",
          "evidence": [
            {
              "locator": "specs/import-feasibility/spec-v1.md#scope-review",
              "note": "Hypothetical achievement and deferral analysis."
            }
          ]
        },
        {
          "expectation": "Separate evidence-backed findings from assumptions and unresolved feasibility questions.",
          "required": true,
          "result": "passed",
          "explanation": "Separated the proposal inventory, inferred milestone value, and unverified execution limits.",
          "evidence": [
            {
              "locator": "specs/import-feasibility/spec-v1.md#scope-review",
              "note": "Hypothetical evidence and uncertainty register."
            }
          ]
        }
      ]
    },
    "uncertainties": [
      {
        "description": "Execution limits have not been measured against the required input size.",
        "impact": "Implementation feasibility remains unknown; a bounded execution probe is needed."
      }
    ],
    "references": [],
    "related_messages": [
      { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "a7c91e3b4d62" }
    ]
  },
  "reply_expectation": null
}
```

## Adaptation and next step

Copy the actual PM request requirements verbatim into required checks. If a required assessment action is unfinished or lacks evidence, report `in_progress`/`blocked` instead. Uncertainty about future implementation can remain after an assessment whose explicit deliverable was identifying that uncertainty. PM decides and records the scope; no separate decision acknowledgment is needed.
