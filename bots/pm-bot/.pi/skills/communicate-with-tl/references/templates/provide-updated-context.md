# Provide updated context for affected work

Use when a new spec version affects active work, requires a pause, or changes the recipient's next action. A recorded go/no-go decision by itself does not require this message.

## Agent Mail example

Tool: `send_agent_message`. The pause below is an actionable scope delta, not a mandatory product-decision announcement. All paths and activity are illustrative.

```json
{
  "recipient": "tl",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Pause bulk-import work; the current first milestone covers one project only.",
    "context": [
      "The revised spec defers bulk import, automatic retries, and live progress.",
      "Single-project investigation remains within scope; this message does not authorize additional implementation."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Pause affected bulk-import assignments and identify technical plans/tasks that need revision.",
      "requirements": [
        "Do not continue bulk-import work under the superseded first-milestone scope."
      ],
      "expected_response": "Report the affected work's actual state and the next bounded plan adjustment."
    },
    "result": null,
    "uncertainties": [],
    "references": [
      {
        "locator": "specs/project-import/spec-v2.md",
        "note": "Illustrative authoritative scope; replace with the current spec and actual recorded decision locator."
      }
    ],
    "related_messages": []
  },
  "reply_expectation": { "window": "short" }
}
```

## Adaptation and next step

State only the change relevant to TL's action. If the message is purely informational, use `request: null` and `reply_expectation: null`. If a pause or update is requested, await an honest status rather than assuming mail delivery stopped work.
