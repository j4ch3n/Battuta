# Report progress or an evidence-backed result

Use when a requested action is ongoing or verified. State the action's status, not the feature's overall acceptance or release status.

## Progress example

Tool: `reply_agent_message`. This fictional probe request has one requirement: `Report whether the import timeout fits milestone 1.` Replace all message references and evidence with actual inspected records.

```json
{
  "parent": { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "c9e13a5b6d84" },
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "The timeout probe is running; its required conclusion is not verified yet.",
    "context": ["Investigation only; no implementation or release claim."],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": null,
    "result": {
      "state": "in_progress",
      "accomplished": ["Prepared the representative-input probe."],
      "remaining": ["Run the probe and compare its result with the current milestone acceptance."],
      "checks": [
        {
          "expectation": "Report whether the import timeout fits milestone 1.",
          "required": true,
          "result": "not_verified",
          "explanation": "The representative-input result is pending.",
          "evidence": []
        }
      ]
    },
    "uncertainties": [],
    "references": [],
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
  "recipient": "pm",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "The representative-input timeout probe passed for the current first milestone.",
    "context": [
      "Only the requested timeout assessment is complete; implementation remains separate."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": null,
    "result": {
      "state": "complete",
      "accomplished": [
        "Ran the representative-input probe and compared it with the current acceptance boundary."
      ],
      "remaining": [],
      "checks": [
        {
          "expectation": "Report whether the import timeout fits milestone 1.",
          "required": true,
          "result": "passed",
          "explanation": "The hypothetical required input completes within the configured timeout; larger inputs are outside this check.",
          "evidence": [
            {
              "locator": "specs/import-feasibility/spec-v2.md#timeout-probe",
              "note": "Hypothetical measured probe and configured execution limit."
            }
          ]
        }
      ]
    },
    "uncertainties": [],
    "references": [],
    "related_messages": [
      { "conversation_id": "550e8400-e29b-41d4-a716-446655440000", "id": "c9e13a5b6d84" }
    ]
  },
  "reply_expectation": null
}
```

## Adaptation and next step

For a completed action, cover every original requirement verbatim with a passing evidence-backed required check, accomplishments, and no remaining action work. Use `blocked` with the actual blocker or `in_progress` when required evidence is missing. A negative feasibility conclusion can still complete an assessment if its required deliverable was a supported answer, not successful implementation.
