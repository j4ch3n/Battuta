# Report progress or an evidence-backed result

Use when a requested action is ongoing or verified. State the action's status, not the feature's overall acceptance or release status.

Apply this pattern to authorized implementation and other substantive work as
well as investigation. Manager owns planning, assignment coordination and review
of worker execution/verification evidence; CoS owns final owner communication. Report decisions needed
to CoS rather than sending the owner a direct fallback message.

## Progress example

Tool: `reply_agent_message`. This fictional probe request has one requirement: `Report whether the import timeout fits milestone 1.` Replace all message references and evidence with actual inspected records.

```json
{
  "parent": { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "c9e13a5b6d84" },
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "The timeout probe is running; its required conclusion is not verified yet.",
    "body": "assignment_id: a3f91c2e. TODO position 1 is in_progress. Investigation only; no implementation or release claim. Next: obtain the worker probe results and review them against milestone acceptance.",
    "result": {
      "state": "in_progress",
      "checks": [{ "req": 1, "result": "not_verified" }]
    },
    "related_messages": [
      { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "c9e13a5b6d84" }
    ]
  },
  "reply_expectation": null
}
```

## Later-result example

Tool: `send_agent_message`. A progress reply consumed the single direct reply, so the later result is new mail linked to the original request. The probe and passing result below are hypothetical, not Battuta findings.

```json
{
  "recipient": "cos",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "The representative-input timeout probe passed for the current first milestone.",
    "body": "assignment_id: a3f91c2e. Worker execution recorded TODO position 1 and the assessment assignment done; Manager inspected the probe evidence. This is not owner acceptance. The hypothetical required input completes within the configured timeout; larger inputs are outside this check. Only the requested timeout assessment is complete; implementation remains separate.",
    "result": {
      "state": "complete",
      "checks": [
        {
          "req": 1,
          "result": "passed",
          "evidence": "specs/import-feasibility/spec-v2.md#timeout-probe"
        }
      ]
    },
    "related_messages": [
      { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "c9e13a5b6d84" }
    ]
  },
  "reply_expectation": null
}
```

## Adaptation and next step

For a completed action, cover every original requirement by position with a passed, evidence-backed check. Use `blocked` with the actual `blocker` or `in_progress` when required evidence is missing. A negative feasibility conclusion can still complete an assessment if its required deliverable was a supported answer, not successful implementation.
