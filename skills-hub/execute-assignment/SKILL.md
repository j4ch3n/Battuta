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
Work is run through `delegate` and stays within the commission; the bound executor
supervises it and retains responsibility for evidence, integration and reporting.

## Orient to the commission

Wait for the bound TODO and supplied output paths before executing work;
report missing essential inputs. Assignment selection and claiming are automatic,
not model actions.

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
   to match metadata. When you need a worktree of your own, create it with
   `battuta-project worktree create`, not `git worktree`.
4. Read the supplied PRD/version and other relevant input paths. For a referenced
   Linear ticket, read its description, acceptance, and consequential discussion
   using existing authorized tools when available. Otherwise read Manager's
   supplied ticket content and source reference; distinguish supplied evidence
   from a live lookup. Do not invent ticket access or treat a URL as read content.
5. Compare those inputs with the commission and current evidence. Return
   consequential conflicts, missing authority, project mismatches, or essential
   inaccessible inputs to Manager through a blocked execution result. Do not
    silently adopt a newer ticket comment as changed scope. Skip project
    registration/orientation when note-only work has sufficient supplied inputs. Skip repository and
   ticket steps when they are irrelevant to research, writing, or another
   non-repository deliverable; do not fabricate requirements to complete a ritual.

## Execute, verify, and report

1. Turn the TODO into a self-contained `delegate` objective: goal, constraints,
   exclusions, input paths, acceptance, and the evidence to report. Pick the mode
   by work type: `plan` when the approach is unclear, `research` for external
   investigation, `implement` for edits and their checks, `review` for judging
   finished work. Orientation reading is for writing a good objective, not for
   doing the work yourself. Use draft-writing for text drafts and artifacts for
   commissioned HTML/visual deliverables and explicitly authorized publication
   when the assignment names them; without the `delegate` tool, do the work
   directly.
   - Set `cwd` to the commissioned worktree or this assignment's work folder, or
     omit it for the project code folder.
   - `delegate` starts the run in the background and returns at once. Only one
     run can be active at a time.
   - While it runs, keep handling mail and follow-ups. Check progress with
     `delegate_status` and pass it on to Manager when it matters.
   - Claude's questions and permission requests arrive as messages. Answer each
     with `delegate_reply` and its `requestId`. Ask Manager first when the answer
     needs authority you do not have, and deny anything outside the commission.
   - To send guidance, such as a Manager follow-up that changes the objective,
     use `delegate_reply` without a `requestId`.
   - Stop a run that is going wrong with `delegate_stop`.
   - The run's result arrives as a finished message. Do not submit
     `report_execution_result` while a run is active.
2. Read each run's summary against the TODO and acceptance, and inspect the
   actual changes when the summary is thin or the stakes are high. Executable
   changes should be test-first and checked for regressions; make sure the
   objective asks for that. When the TODO is a review, run one `review` per
   focus the brief names, each in a fresh session, and do not review work from the
   session that wrote it. Send failed findings to a new `implement` run, then
   re-review that focus. Verify against the commissioned acceptance; distinguish
   observed results, inference, missing evidence, and unavailable checks. A
   blocked check is not a pass.
3. Use the `note-taking` skill to prepare or locate notes and follow the tool's
   guidance. Preserve existing material and record concise findings, actual
   verification, and real evidence references, not a tool-call diary. Do not
   persist credentials, private owner-profile data, or unrelated personal context.
   Local scratch files are not synchronized. Include sufficient
   findings/deliverable content in the persisted result for Manager to review;
   inaccessible required content is a blocker, not a successful remote delivery.
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
claim tokens are supplied automatically; do not include them in this report.

## Boundaries and recovery

- Do not claim, start, complete, cancel, reactivate, or edit execution state through
  generic tools. Do not send the mandatory Manager result mail yourself.
- Unresolvable input, authority, runtime, or verification gaps require a truthful
  blocked report. Final prose, model idleness, and a successful tool exit are not
  proof of success. Never invent approvals or acceptance.
- Follow the bound TODO sequence; no per-TODO workers or nested assignments.
  Manager decides replanning and recovery after a blocker.
- The 45-minute lease timestamp is informational only. Do not renew, release,
  reclaim, or stop solely because it elapsed.
- Notes/drafts are editable while active/in_process/blocked and freeze only on
  done/cancelled. Another machine may lack them; report missing inputs honestly.

## Why and examples

Use Manager's supplied worktree after checking its repository identity, read the
named PRD and ticket evidence, and report the requested change with actual checks.
A refused `cwd` is a blocker to report, not a reason to delegate from another
directory.
**Why:** orientation prevents cross-project mistakes without replacing the
commission or expanding authority.

Start a new Claude session (omit `sessionId`):

- for the first run of a piece of work;
- for every `review`, one fresh session per focus, never the session that wrote
  the work;
- for a different objective, even within the same TODO;
- when a session went off track or its context is cluttered;
- always at the start of a new assignment, because sessions from other
  assignments are refused.

Reuse a session (pass its `sessionId`, from the run's started or finished message
or `delegate_status`):

- to continue the same objective, such as `implement` after its own `plan`;
- to continue a run that ended with open questions, now that you have the
  answers;
- to resume a run reported as interrupted after a restart.

A resumed run stays in its original folder, so do not pass a different `cwd`.
**Why:** a session carries its context forward. That helps the same objective
and biases a review or a new objective.

Avoid switching to the registered default checkout, adopting unrelated ticket
scope, or sending “done”/duplicate mail instead of `report_execution_result`.
**Why:** metadata is not an execution order, and final prose cannot prove recorded
progress, settlement, or delivery.
