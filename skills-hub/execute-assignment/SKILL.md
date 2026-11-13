---
name: execute-assignment
description: Use when a bound assignment TODO needs project orientation, commissioned work, verification, or a completed/blocked execution report.
---

# Execute an assignment

## Objective

Understand the commissioned project and inputs, deliver the bound TODO within
its authority, and record verified evidence or an honest blocker through
`report_execution_result`.

## Capabilities and boundaries

This workflow requires a bound assignment TODO and its runtime/tool. Manager
provides the mandate and receives results and consequential questions; CoS owns
high-level product decisions and owner communication. These roles define
authority and routes, not who may invoke the skill.

Project orientation is inspection, not administration: do not initialize projects,
change GitHub/Linear associations, select unrelated tickets, amend canonical
documents, or infer a wider mandate. A summary, ticket comment, PRD, or recorded
go decision is evidence, not new execution, merge, or publication authority.

Extension code owns claims, ordered progress, completion, and mandatory Manager
mail. This skill creates neither a bound task nor access to tools; it does not
permit direct execution-state writes, owner contact, or new assignments.
Bounded assistance from available subagents stays within the commission; the
bound executor retains responsibility for evidence, integration and reporting.

## Orient to the commission

1. Read the bound project, goal, current TODO, prerequisite results, constraints,
   exclusions, acceptance, authority, and Manager's input paths. Use assignment
   MCP to inspect the bound context as needed. Retain context across ordered TODOs;
   unrelated assignments do not inherit this project's mandate.
2. For work needing project context, inspect only the named project:

   ```sh
   battuta-project explain <project-name>
   ```

   Replace the placeholder with the exact supplied name and shell-quote it when
   needed. The read-only output shows the project summary, registered repository
   checkout (`Project Root`), separate managed directory, Summary path, repository
   and Linear project URLs, and repository guidance index. It does not fetch ticket
   contents, discover spec versions, or select an execution project. A CLI or
   linked-project lookup failure is not proof the project has no context; report
   the actual failure if it blocks essential orientation.
3. Read the overview and relevant README/AGENTS guidance. Use the explicitly
   commissioned checkout/worktree; if none is specified, use the registered
   checkout. For repository work, inspect Git root, branch and working-tree state
   and verify the checkout belongs to the intended repository. A worktree can
   legitimately differ from the registered checkout. Preserve existing changes;
   do not switch branches, replace the commissioned checkout, or reset work just
   to match metadata.
4. Read the supplied PRD/version and other relevant input paths. For a referenced
   Linear ticket, read its description, acceptance, and consequential discussion
   using existing authorized tools when available. Otherwise read Manager's
   supplied ticket content and source reference; distinguish supplied evidence
   from a live lookup. Do not invent ticket access or treat a URL as read content.
5. Compare those inputs with the commission and current evidence. Return
   consequential conflicts, missing authority, project mismatches, or essential
   inaccessible inputs to Manager through a blocked execution result. Do not
   silently adopt a newer ticket comment as changed scope. Skip repository and
   ticket steps when they are irrelevant to research, writing, or another
   non-repository deliverable; do not fabricate requirements to complete a ritual.

## Execute, verify, and report

1. Inspect relevant code, documents, and sources beyond suggested keywords when
   evidence requires it. Use research for external investigation, draft-writing
   for text drafts, and artifacts for commissioned HTML/visual deliverables and
   explicitly authorized publication.
2. Produce the smallest complete deliverable within the brief. For executable
   changes, write a meaningful failing test first, implement the change, and run
   relevant regression checks. Verify against the commissioned acceptance;
   distinguish observed results, inference, missing evidence, and unavailable
   checks. A blocked check is not a pass.
3. Use assignment MCP to prepare/locate notes, and built-in file tools for safe
   local work. Preserve existing material and record concise findings, actual
   verification, and real evidence references, not a tool-call diary. Do not
   persist credentials, private owner-profile data, or unrelated personal context.
4. Submit `report_execution_result` for the bound TODO using the contract below.
   Correct malformed input if rejected. Acceptance awaits final turn settlement
   and persistence; a successful call alone proves neither assignment completion
   nor Manager mail delivery. Manager evaluates evidence and decides recovery.

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

Use Manager's supplied worktree after checking its repository identity, read the
named PRD and ticket evidence, and report the requested change with actual checks.
**Why:** orientation prevents cross-project mistakes without replacing the
commission or expanding authority.

Avoid switching to the registered default checkout, adopting unrelated ticket
scope, or sending “done”/duplicate mail instead of `report_execution_result`.
**Why:** metadata is not an execution order, and final prose cannot prove recorded
progress, settlement, or delivery.
