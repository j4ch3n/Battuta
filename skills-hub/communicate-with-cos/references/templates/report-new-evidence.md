# Report material new evidence

Use when new evidence or a concrete blocker affects settled scope. Do not repeat a disposed objection. Refinement can create a new version only while open; if finalized, report the blocker without implying its locked artifacts can be rewritten.

## Agent Mail example

Tool: `send_agent_message`. This fictional measured failure illustrates evidence → impact → recommendation → action needed. Replace the measurement and locators with actual findings.

```json
{
  "recipient": "cos",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "New probe evidence invalidates the required input-size assumption; evaluate the input-size tradeoff and create a new full spec version if the open spec's boundary changes.",
    "body": "Observed: the newly tested required input exceeded the configured execution timeout (specs/import-feasibility/spec-v2.md#timeout-probe, hypothetical; new since the prior assessment). The affected execution path is paused; unrelated authorized work is unchanged. Option A: reduce the supported first-milestone input size, which keeps the boundary smaller but excludes the larger-input scenario. Option B: keep the requirement and assess background execution, which preserves the scenario but adds processing and status behavior; it has not been assessed and is not a verified solution. Recommendation: evaluate whether the smaller-input milestone is still useful before expanding processing scope. Provide the new version or a bounded research request; terminal go/no-go belongs in metadata with rationale.",
    "requirements": ["Resolve the larger-input acceptance boundary using the new probe evidence."]
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Identify what is genuinely new and why it affects acceptance. CoS refines open specs through full new versions or finalizes go/no-go with rationale. Manager reads the explicit current version before affected work; no standalone acknowledgment is required.
