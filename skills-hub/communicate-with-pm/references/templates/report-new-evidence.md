# Report material new evidence

Use when new evidence or a concrete blocker affects settled scope. Do not repeat a disposed objection. Refinement can create a new version only while open; if finalized, report the blocker without implying its locked artifacts can be rewritten.

## Agent Mail example

Tool: `send_agent_message`. This fictional measured failure illustrates evidence → impact → recommendation → action needed. Replace the measurement and locators with actual findings.

```json
{
  "recipient": "pm",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "New probe evidence invalidates the required input-size assumption; reassess that scope boundary.",
    "context": [
      "The current spec selects one-project import with a final result.",
      "The affected execution path is paused; unrelated authorized work is unchanged."
    ],
    "findings": [
      {
        "statement": "The newly tested required input exceeded the configured execution timeout.",
        "basis": "observed",
        "evidence": [
          {
            "locator": "specs/import-feasibility/spec-v2.md#timeout-probe",
            "note": "Hypothetical failing representative-input result, new since the prior assessment."
          }
        ]
      }
    ],
    "options": [
      {
        "description": "Reduce the supported first-milestone input size.",
        "benefits": ["Keeps the execution boundary smaller."],
        "drawbacks": ["Excludes the larger-input user scenario."]
      },
      {
        "description": "Retain the input requirement and assess background execution.",
        "benefits": ["Preserves the larger-input scenario."],
        "drawbacks": ["Adds processing and status behavior to the milestone."]
      }
    ],
    "recommendation": "Evaluate whether the smaller-input milestone is still useful before expanding processing scope.",
    "request": {
      "action": "Evaluate the input-size tradeoff and create a new full version if the open spec's boundary changes.",
      "requirements": [
        "Resolve the larger-input acceptance boundary using the new probe evidence."
      ],
      "expected_response": "Provide the explicit new version or a bounded research request; terminal go/no-go belongs in metadata with rationale."
    },
    "result": null,
    "uncertainties": [
      {
        "description": "Background execution has not been assessed.",
        "impact": "It is an alternative for research, not a verified solution."
      }
    ],
    "references": [
      {
        "locator": "specs/project-import/spec-v2.md",
        "note": "Illustrative current acceptance boundary and product decision history."
      }
    ],
    "related_messages": []
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Identify what is genuinely new and why it affects acceptance. PM refines open specs through full new versions or finalizes go/no-go with rationale. TL reads the explicit current version before affected work; no standalone acknowledgment is required.
