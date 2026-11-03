# Request one product clarification

Use when different interpretations change the user outcome or acceptance boundary. Read existing decisions first; ask the one question that blocks the next action.

## Agent Mail example

Tool: `reply_agent_message`. The parent and feature are illustrative; use the current request's actual `message_ref` and real evidence.

```json
{
  "parent": { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "a7c91e3b4d62" },
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Clarify whether failed imports need user confirmation before retry.",
    "context": ["The retry assessment cannot choose between two conflicting user behaviors."],
    "findings": [
      {
        "statement": "The example requirements describe automatic retry, while the acceptance scenario requires user confirmation.",
        "basis": "observed",
        "evidence": [
          {
            "locator": "specs/project-import/spec-v1.md",
            "note": "Hypothetical conflicting retry requirement and acceptance scenario."
          }
        ]
      }
    ],
    "options": [
      {
        "description": "Require user confirmation.",
        "benefits": ["User controls the next attempt."],
        "drawbacks": ["Recovery needs a user action."]
      },
      {
        "description": "Retry automatically.",
        "benefits": ["Recovery needs no immediate user action."],
        "drawbacks": ["Retry limits and repeat-processing behavior need specification."]
      }
    ],
    "recommendation": "Prefer manual retry for the first milestone, deferring automatic recovery policy.",
    "request": {
      "action": "Resolve the retry acceptance boundary in a new full spec version while it is open.",
      "requirements": ["State whether retry requires user confirmation."],
      "expected_response": "Provide the clarified requirement and current spec reference."
    },
    "result": {
      "state": "blocked",
      "accomplished": ["Identified the conflicting product behaviors."],
      "remaining": ["The retry acceptance boundary needs clarification."],
      "checks": []
    },
    "uncertainties": [
      {
        "description": "The intended retry behavior is unresolved.",
        "impact": "The affected technical assessment is blocked."
      }
    ],
    "references": [],
    "related_messages": []
  },
  "reply_expectation": { "window": "short" }
}
```

## Adaptation and next step

A product question normally goes to PM, not directly to the owner. When the clarified spec is available, reassess the affected behavior and continue only authorized work. If this clarification was the initial reply, later results must be a new send linked to the original request.
