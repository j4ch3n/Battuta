---
name: execute-assignment
description: Use when a bound assignment TODO needs execution, a verified outcome report, or a truthful execution blocker.
---

# Execute an assignment

## Objective

Produce the bound TODO's verified deliverable, or an honest blocker, through
`report_execution_result`.

## Capabilities and boundaries

This workflow requires a bound assignment TODO and the assignment runtime/tool.
Extension code owns claims, ordered progress, assignment completion, and
mandatory Manager mail; Manager receives the result and decides recovery. Using
this skill does not create a bound task, authorize a different project, or permit
direct execution-state writes.

## Workflow

1. Read the explicit project, goal, constraints, current TODO, prerequisite results,
   acceptance checks, and Manager-supplied checkout/document paths, including the
   relevant PRD when provided. Follow those instructions rather than discovering
   a project or inferring requirements. Missing authority, a project mismatch,
   or an essential inaccessible input requires a blocked report to Manager.
2. Inspect relevant code, documents, and sources. Investigate beyond suggested
   keywords when evidence requires it. Use research for external investigation;
   supplied assignment context is not current truth or execution authority.
3. Perform the smallest complete change/deliverable. For executable changes, write
   a meaningful failing test first, implement the fix, and run relevant regression
   checks. A blocked check is not a passed check. Avoid unrelated features.
4. Use assignment MCP to inspect TODO/context and prepare/locate notes. Use built-in
   file tools to inspect/edit safe local paths, preserving existing material.
   Record concise findings, actual verification, and real evidence references,
   not a tool-call diary. Use draft-writing for text drafts and artifacts for
   commissioned HTML/visual deliverables and authorized publication.
5. Submit `report_execution_result` for this TODO. Correct malformed input if the
   tool rejects it. Acceptance awaits final turn settlement and persistence;
   it does not itself prove assignment completion or mail delivery.

## Result contract

```json
{
  "outcome": "completed",
  "summary": "Implemented the commissioned behavior and passed the focused regression checks.",
  "evidence": ["tests/actual-regression.test.ts", "actual-report-path"]
}
```

Use actual evidence, not the illustrative paths above. `evidence: []` means none
exists; do not embellish. For `outcome: "blocked"`, also provide a nonblank
`blocker` explanation and describe actual progress in `summary`. Identity and
claim tokens are bound by code, not tool arguments.

## Boundaries and recovery

- Do not claim, start, complete, cancel, reactivate, or edit execution state through
  generic tools. Do not send the mandatory Manager result mail yourself.
- Unresolvable input, authority, runtime, or verification gaps require a truthful
  blocked report. Final prose, model idleness, and a successful tool exit are not
  proof of success. Never invent approvals or acceptance.
- Follow the bound TODO sequence; no per-TODO workers or nested delegation.
  Manager decides replanning and recovery after a blocker.
- The 45-minute lease timestamp is informational only. Do not renew, release,
  reclaim, or stop solely because it elapsed.
- Notes/drafts are editable while active/in_process/blocked and freeze only on
  done/cancelled. Another machine may lack them; report missing inputs honestly.

## Why and examples

Report a completed result with actual checks and evidence, or report `blocked`
with the nonblank blocker and partial progress. **Why:** persistence, settlement,
and delivery are separate outcomes that final prose cannot prove.

Avoid a duplicate Manager mail or “done” final answer instead of
`report_execution_result`. **Why:** neither reaches the runtime contract that
records evidence and enables recovery.
