# Persistent assignment workers

`assignment-worker/` runs one long-lived Pi runtime per worker instance. A fixed
set of operator-started workers competes for whole assignments; no pool manager,
dispatch queue, result queue, or scheduler daemon is introduced.

## Responsibilities

- CoS supplies the confirmed project, intended outcome, constraints, and authority.
- Manager determines the solution and publishes complete assignment plans and
  prerequisites. It remains available for asynchronous results and blockers.
- Workers execute ordered TODOs and report explicit outcomes. Extension code
  owns claim/progress/completion and mandatory Manager mail.
- Manager inspects authoritative state and evidence, integrates results, handles
  blockers/replanning, and reports to CoS. CoS retains owner-facing judgment.

See [assignment runtime](assignments.md) for schema, RPC/tool, dependency, state,
and privilege contracts. Assignment completion is not product acceptance.

## Native Pi lifecycle

The host fixes cwd to the worker directory and agentDir to its private `.pi`.
Setup consumes `bots/worker/skills.json`; Pi natively discovers the prepared
skills, packages, extensions, and instructions. Runtime code does not parse the
manifest or implement a custom resource loader.

Startup creates a fresh idle conversation, never automatically resumes an old
claimed crash session. Availability wakes `/worker-next`, a registered control
command that does not require a model call. Busy/pending contexts do not claim.
One serialized coordinator owns at most one binding and one running TODO.

After claiming, `newSession` starts a fresh conversation at the same cwd/agentDir.
Setup records the binding before the new extension restores it. Old callbacks
are fenced during disposal; a host-owned failure path can record an acquired
claim's blocker if replacement fails. TODOs within an assignment retain one
conversation; unrelated or reactivated assignments get a fresh one.

The extension persists TODO start before prompting. The model's strict
`report_execution_result` tool has no identity/token fields and accepts completed
or blocked, nonblank summary, real evidence references, and a required blocker
for blocked. Identical duplicate reports are harmless; distinct replacements
are refused. An accepted report waits for final turn settlement. A final abort
or error overrides a submitted success; missing reports become blockers.

Approved work tools, assignment inspection/notes, and read-only memory are
available. Claim/status/control/mail mutations are excluded from model tool
registration, including native MCP/codemode discovery. Shell and the backend
secret still make this a trusted process, **not a security sandbox**. No Telegram,
worker inbox, nested delegation, owner-profile preload, or memory capture runs.

## Same-project boundary

Workers currently use the same project through existing `battuta-project`
commands and paths. The runtime does not resolve workspaces, switch cwd/projects,
or change global current-project configuration. The operator must commission
only the intended project for this deployment; a discovered mismatch/missing
context is a blocker, not an automatic unclaim.

Concurrent workers may share project files. Manager must choose non-conflicting
boundaries or dependencies. No locking or file synchronization is added; missing
local input must be reported honestly rather than assumed to exist elsewhere.

## Notification and manual operations

After confirmed done/blocked persistence, the extension sends one chat from
`worker` to `manager`, using the assignment conversation UUID. Mail contains
bounded outcomes/evidence and points to the full authoritative ledger. Its sole
automatic completion check verifies done plus a nonempty terminal TODO set;
it does not claim independent implementation or product verification.

Local Pi custom entries retain binding, accepted-report, handoff, and mail
intent/receipt diagnostics. Known failure, ambiguous acknowledgement, or a lost
local receipt is surfaced without blind retry, durable outbox, or automatic
restart resend. Execution remains done/blocked if mail fails; Manager can inspect
the board when a notification is missing. Never rerun completed work to resend mail.

For blocked work, Manager may cancel/replace the assignment or cancel unfinished
TODOs, append revised steps, and reactivate explicitly. Keep completed evidence.
Reactivation invalidates the old claim; cancelled prerequisites never unlock
dependents and terminal work cannot reopen.

The 45-minute lease is informational only. To handle a crashed/uncertain worker,
first verify the process is stopped and inspect its exact claim and stored TODOs.
Do not start another worker as an implicit takeover. An authorized operator can
record an honest claim-bound runtime blocker, then Manager can use the normal
blocked-work recovery workflow. Unconfirmed writes or mail require inspection,
not automatic retry. SIGINT/SIGTERM disposes timers/connections without releasing
the claim. Automatic crash recovery, age-based reclaim, and a dynamic pool remain
out of scope.
