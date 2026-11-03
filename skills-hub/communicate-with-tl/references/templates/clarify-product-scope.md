# Clarify product scope

Use to answer TL's focused product question after resolving the acceptance boundary in the current spec. Do not return only an abstract approval when the actual requirements still conflict.

## Agent Mail example

Tool: `reply_agent_message`. Replace `parent` with the actual incoming `message_ref`. This is fictional context, not an established decision.

```json
{
  "parent": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "id": "b8d02f4a5c73"
  },
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "The current acceptance boundary requires manual retry; automatic retry is deferred.",
    "context": [
      "The spec now requires an explicit user action before retrying a failed import.",
      "This answers the retry-behavior question; it does not authorize implementation."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": null,
    "result": null,
    "uncertainties": [],
    "references": [
      {
        "locator": "specs/project-import/spec-v2.md#functional-requirements",
        "note": "Illustrative revised retry requirement; use the actual saved spec location."
      }
    ],
    "related_messages": []
  },
  "reply_expectation": null
}
```

## Adaptation and next step

Reference the saved immutable version created through PM's tools, rather than making mail the only requirement record. This answer needs no acknowledgment. If TL must perform a new assessment, use a focused request and non-null reply expectation instead of implying implementation authorization.
