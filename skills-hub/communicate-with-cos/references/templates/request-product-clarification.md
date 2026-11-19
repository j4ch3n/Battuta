# Request one product clarification

Use when different interpretations change the user outcome or acceptance boundary. Read existing decisions first; ask the one question that blocks the next action.

## Agent Mail example

Tool: `reply_agent_message`. The parent and feature are illustrative; use the current request's actual `message_ref` and real evidence.

```json
{
  "parent": { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "a7c91e3b4d62" },
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "Clarify whether failed imports need user confirmation before retry. Resolve the retry acceptance boundary in a new full spec version while the spec is open.",
    "body": "Observed: the example requirements describe automatic retry, while the acceptance scenario requires user confirmation (specs/project-import/spec-v1.md, hypothetical). Option A, require confirmation: the user controls the next attempt, but recovery needs a user action. Option B, retry automatically: no immediate user action, but retry limits and repeat-processing behavior need specification. Recommendation: manual retry for the first milestone, deferring automatic recovery policy. The affected technical assessment is blocked until this is resolved.",
    "requirements": ["State whether retry requires user confirmation."],
    "result": {
      "state": "blocked",
      "checks": [],
      "blocker": "The retry acceptance boundary needs clarification."
    }
  },
  "reply_expectation": { "window": "short" }
}
```

## Adaptation and next step

A product question normally goes to CoS, not directly to the owner. When the clarified spec is available, reassess the affected behavior and continue only authorized work. If this clarification was the initial reply, later results must be a new send linked to the original request.
