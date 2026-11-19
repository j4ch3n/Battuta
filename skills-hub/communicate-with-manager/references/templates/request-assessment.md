# Commission work or request an assessment

Use when a desired product outcome is clear but feasibility or the smallest useful milestone is unresolved. Supply the current spec, constraints, and the decision the research must support. This requests assessment, not implementation.

## Agent Mail example

Tool: `send_agent_message`. This fictional import feature illustrates the message shape; replace its project, paths and context with actual artifacts.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "objective": "Assess feasibility and recommend the smallest useful first milestone for project import. Assessment only; implementation is not authorized.",
    "body": "Desired outcome: import a project and see a final success or failure result. The proposal also includes bulk import, automatic retries, and live progress. Budget means bounded scope and tradeoffs. Current spec: specs/project-import/spec-v1.md (illustrative; use the resolved real spec).",
    "requirements": [
      "Compare a smaller milestone with the full proposal.",
      "Identify the achievement, deferred scope, and consequences of deferral.",
      "Separate evidence-backed findings from assumptions and unresolved feasibility questions."
    ]
  },
  "reply_expectation": { "window": "medium" }
}
```

## Adaptation and next step

Use observable requirements; the result's checks cover them by position. Choose the response window for the depth of assessment, not as a delivery estimate. CoS evaluates Manager's findings and records its product decision through project-management; a separate go/no-go mail is unnecessary.

## Authorized work example

Use only with confirmed execution authority. CoS does not produce Manager's breakdown or detailed execution plan first. The following fictional commission delegates both planning and execution; an assessment request above does not.

Tool: `send_agent_message`.

```json
{
  "recipient": "manager",
  "message_type": "chat",
  "content": {
    "project": "atlas",
    "ticket": "ATL-12",
    "objective": "Plan and deliver the authorized first import milestone: frame and break it down, commission worker investigation, implementation and verification through assignments, and coordinate dependencies and review.",
    "body": "The owner authorized implementation of milestone 1 only; bulk import and retries remain excluded. Create complete assignments/TODOs and existing prerequisites before workers claim them. Scope and acceptance: specs/project-import/spec-v1.md (fictional; substitute actual inspected artifacts and authority). Return the deliverable, verification evidence, remaining uncertainty, and product or authority decisions needed.",
    "requirements": [
      "Import one valid project and report its final success or failure result.",
      "Verify the milestone against its acceptance criteria."
    ]
  },
  "reply_expectation": { "window": "long" }
}
```
