# Provide updated context for affected work

Use when a new spec version affects active work, requires a pause, or changes the recipient's next action. A recorded go/no-go decision by itself does not require this message.

## Agent Mail example

Tool: `send_agent_message`. The pause below is an actionable scope delta, not a mandatory product-decision announcement. All paths and activity are illustrative.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "Pause bulk-import work; the current first milestone covers one project only. Identify the plans and tasks that need revision.",
    "body": "The revised spec defers bulk import, automatic retries, and live progress. Single-project investigation remains in scope; this message does not authorize additional implementation. Authoritative scope: specs/project-import/spec-v2.md (illustrative; use the current spec and recorded decision). Report the affected work's actual state and the next bounded plan adjustment.",
    "requirements": ["Do not continue bulk-import work under the superseded first-milestone scope."]
  },
  "reply_expectation": { "window": "short" }
}
```

## Adaptation and next step

State only the change relevant to Manager's action. If the message is purely informational, omit `requirements` and use `reply_expectation: null`. If a pause or update is requested, await an honest status rather than assuming mail delivery stopped work.
