# Commission work or request an assessment

Use when a desired product outcome is clear but feasibility or the smallest useful milestone is unresolved. Supply the current spec, constraints, and the decision the research must support. This requests assessment, not implementation.

## Agent Mail example

Tool: `send_agent_message`. This fictional import feature illustrates the message shape; replace its project paths and context with actual artifacts.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Recommend the smallest useful milestone for project import.",
    "context": [
      "Project: atlas; assignment_id: a3f91c2e. CoS created this commission after confirming project registration.",
      "Desired outcome: import a project and see a final success or failure result.",
      "The proposal also includes bulk import, automatic retries, and live progress.",
      "Budget means bounded scope and tradeoffs. Assessment only; implementation is not authorized."
    ],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Assess feasibility and recommend a useful first achievement milestone.",
      "requirements": [
        "Compare a smaller milestone with the full proposal.",
        "Identify the achievement, deferred scope, and consequences of deferral.",
        "Separate evidence-backed findings from assumptions and unresolved feasibility questions."
      ],
      "expected_response": "Report scope alternatives, the recommended milestone, evidence, and any bounded probe still needed."
    },
    "result": null,
    "uncertainties": [],
    "references": [
      {
        "locator": "specs/project-import/spec-v1.md",
        "note": "Illustrative current product requirements; replace with the resolved real feature spec."
      }
    ],
    "related_messages": []
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Use observable requirements; Manager must preserve their exact wording in completed-result checks. Choose the response window for the depth of assessment, not as a delivery estimate. CoS evaluates Manager's findings and records its product decision through project-management; a separate go/no-go mail is unnecessary.

## Authorized work example

Use only with confirmed execution authority. CoS does not produce Manager's
breakdown or detailed execution plan first. The following fictional commission
delegates both planning and execution; an assessment request above does not.

Tool: `send_agent_message`.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "schema_version": 1,
    "summary": "Plan and deliver the authorized first import milestone.",
    "context": ["Project: atlas; assignment_id: a3f91c2e. Maintain the shared TODOs for this commission.", "The owner authorized implementation of milestone 1 only; bulk import and retries remain excluded."],
    "findings": [],
    "options": [],
    "recommendation": null,
    "request": {
      "action": "Investigate, break down, plan, and execute or coordinate the authorized milestone.",
      "requirements": ["Import one valid project and report its final success or failure result.", "Verify the milestone against its acceptance criteria."],
      "expected_response": "Return the deliverable, verification evidence, remaining uncertainty, and product or authority decisions needed."
    },
    "result": null,
    "uncertainties": [],
    "references": [{"locator": "specs/project-import/spec-v1.md", "note": "Fictional approved scope and acceptance; substitute actual inspected artifacts and authority."}],
    "related_messages": []
  },
  "reply_expectation": {"window": "long"}
}
```
