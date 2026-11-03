# Request bounded reassessment

Use when a changed requirement or new evidence invalidates a specific technical assumption. Read the prior assessment; do not restart the whole discovery conversation.

## Agent Mail example

Tool: `send_agent_message`. Replace the example spec location and earlier message reference with actual inspected artifacts/mail.

```json
{
  "recipient": "tl",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Reassess import execution limits for the newly required larger input.",
    "context": [
      "The first milestone still covers one project and a final success or failure result.",
      "The required input size changed; bulk import, retries, and live progress remain deferred.",
      "Reassessment only; do not implement or introduce infrastructure."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Check only the changed input-size assumption against the current execution path.",
      "requirements": [
        "Identify whether the changed input requirement fits existing execution limits, with evidence.",
        "Recommend the smallest scope adjustment or bounded probe if it does not."
      ],
      "expected_response": "Return the changed feasibility conclusion, evidence, and remaining uncertainty."
    },
    "result": null,
    "uncertainties": [],
    "references": [
      {
        "locator": "specs/project-import/spec-v2.md",
        "note": "Illustrative revised input-size requirement; use the saved current version."
      }
    ],
    "related_messages": [
      {
        "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
        "id": "a7c91e3b4d62"
      }
    ]
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Identify what changed and what remains settled. PM saves full refinements as new immutable versions while open; TL supplies affected technical analysis and owns canonical checklist/review writes. Terminal specs cannot be amended.
