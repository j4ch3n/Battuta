# Request a technical scope assessment

Use when a desired product outcome is clear but feasibility or the smallest useful milestone is unresolved. Supply the current spec, constraints, and the decision the research must support. This requests assessment, not implementation.

## Agent Mail example

Tool: `send_agent_message`. This fictional import feature illustrates the message shape; replace its project paths and context with actual artifacts.

```json
{
  "recipient": "tl",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Recommend the smallest useful milestone for project import.",
    "context": [
      "Desired outcome: import a project and see a final success or failure result.",
      "The proposal also includes bulk import, automatic retries, and live progress.",
      "Budget means bounded scope and tradeoffs. Assessment only; implementation is not authorized."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Assess feasibility and recommend a useful first achievement milestone.",
      "requirements": [
        "Compare a smaller milestone with the full proposal.",
        "Identify the achievement, deferred scope, and consequences of deferral.",
        "Separate evidence-backed findings from assumptions and unresolved feasibility questions."
      ],
      "expected_response": "Report scope alternatives, the recommended milestone, evidence, and any bounded probe still needed."
    },
    "result": null,
    "uncertainties": [],
    "references": [
      {
        "locator": "specs/project-import/spec-v1.md",
        "note": "Illustrative current product requirements; replace with the resolved real feature spec."
      }
    ],
    "related_messages": []
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Use observable requirements; TL must preserve their exact wording in completed-result checks. Choose the response window for the depth of assessment, not as a delivery estimate. PM evaluates TL's findings and records its product decision through project-management; a separate go/no-go mail is unnecessary.
