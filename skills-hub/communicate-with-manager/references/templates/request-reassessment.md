# Request bounded reassessment

Use when a changed requirement or new evidence invalidates a specific technical assumption. Read the prior assessment; do not restart the whole discovery conversation.

## Agent Mail example

Tool: `send_agent_message`. Replace the example spec location and earlier message reference with actual inspected artifacts/mail.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "Reassess import execution limits for the newly required larger input. Check only the changed input-size assumption against the current execution path.",
    "body": "The first milestone still covers one project and a final success or failure result. The required input size changed; bulk import, retries, and live progress remain deferred. Reassessment only; do not implement or introduce infrastructure. Revised requirement: specs/project-import/spec-v2.md (illustrative; use the saved current version). Return the changed feasibility conclusion, evidence, and remaining uncertainty.",
    "requirements": [
      "Identify whether the changed input requirement fits existing execution limits, with evidence.",
      "Recommend the smallest scope adjustment or bounded probe if it does not."
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

Identify what changed and what remains settled. CoS saves full refinements as new immutable versions while open; Manager supplies affected technical analysis and owns canonical checklist/review writes. Terminal specs cannot be amended.
