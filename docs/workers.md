# Persistent assignment workers

`assignment-worker/` is a worker-only Pi extension. Each
worker is an ordinary long-lived interactive Pi CLI instance. A fixed
set of operator-started workers competes for whole assignments; no pool manager,
dispatch queue, result queue, or scheduler daemon is introduced.

## Responsibilities

- CoS supplies the confirmed project, intended outcome, constraints, and authority.
- Manager frames the outcome, supplies initial guidance and publishes complete
  assignment plans and prerequisites. Assignment delegation is mandatory for
  worker-level research, implementation, artifacts and execution verification,
  through complete assignments for the next useful milestone, adapting later
  assignments to reviewed findings. Manager may run bounded read-only review
  spot-checks without taking over implementation or formal verification.
  It remains available for asynchronous results,
  reviews evidence and unblocks/replans/escalates to CoS. Managerial records and
  ticket/PR administration remain Manager-owned. Unavailable delegation is a
  disclosed blocker, not an inline-execution fallback.
- Workers execute ordered TODOs and report explicit outcomes. Extension code
  owns claim/progress/completion and mandatory Manager mail.
- Manager inspects authoritative state and evidence, integrates results, handles
  blockers/replanning, and reports to CoS. CoS retains owner-facing judgment.

See [assignment runtime](assignments.md) for schema, RPC/tool, dependency, state,
and privilege contracts. Assignment completion is not product acceptance.

## Native Pi lifecycle

The source launcher uses `bots/worker` as cwd and the manifest-derived private
`.pi` as agentDir, then execs the normal pinned Pi CLI with terminal I/O intact.
There is no custom SDK host. On first launch it creates settings from the shared
profile and manifest defaults, rebasing settings resource paths. It also copies
missing generated MCP configuration and `web-search.json` from `bots/worker`. Private auth
and instructions are not prerequisites. Missing shared MCP configuration stops
launch with a setup command rather than synthesizing endpoints.
Optional full setup prepares `bots/worker` from its `bot.toml` and copies its
configuration into instances. Instances share extension/dependency/catalog resources.
The profile's manifest selects `assignment-worker/index.ts`; source setup links
it into the profile's `.pi/extensions/`, while release assembly stages a compiled
package there. Instance settings do not register that discovered extension again.
Authentication and runtime state are private, never copied. Pi natively discovers the prepared
skills, packages, extensions, and instructions. Runtime code does not parse the
manifest or implement a custom resource loader.

Explicitly configured instances retain setup-only `battutaWorkerResources` ownership metadata.
Explicit reconfiguration replaces those exact owned paths with the current
installation's paths, preserving unrelated custom resources. Pi does not interpret
that metadata at runtime. CoS/Manager configuration never rewrites worker MCP
exposure; worker assignment mutations remain hidden from model/codemode tools.

Installed releases instead use the compiled `bots/worker` role as cwd and
`~/.battuta/pi-bots/worker-N/.pi` as agentDir. Build-generated instructions/skills
and installed dependencies stay in the installation; private configuration is
generated separately without resource merges. `WORKER_BOT_COUNT` selects the
numbered systemd instances. Source and release launchers hold an instance lock
across exec. Foreground maintenance requires the selected service to be stopped;
tmux detach never authorizes starting another process for that identity.

Source launch `--bot-dir` must match the worker manifest's private path.
See [bot setup manifests](bot-setup.md) for the fixed private base, worker
substitution and create-only model/thinking defaults.

Startup creates a fresh idle conversation, never automatically resumes an old
claimed crash session. Availability wakes `/worker-next`, a registered control
command that does not require a model call. Busy/pending contexts do not claim.
One serialized coordinator owns at most one binding and one running TODO.

After claiming, `newSession` starts a fresh conversation at the same cwd/agentDir.
Setup records the binding before the new extension restores it. Disposal stops
the old coordinator and its availability connections. A failed/cancelled handoff
retains the claim for operator inspection rather than invoking a recovery host.
TODOs within an assignment retain one
conversation; unrelated or reactivated assignments get a fresh one.

The extension persists TODO start before dispatching a normal Pi message with
turn triggering. Pi owns execution, provider retries, errors, and terminal
interaction; the extension adds no awaitable sender bridge or prompt-failure
supervisor. A failure before a turn starts may leave the claim/TODO unfinished
for manual inspection. Message delivery is not execution success. The model's strict
`report_execution_result` tool has no identity/token fields and accepts completed
or blocked, nonblank summary, real evidence references, and a required blocker
for blocked. Identical duplicate reports are harmless; distinct replacements
are refused. An accepted report waits for final turn settlement. A final abort
or error overrides a submitted success; missing reports become blockers.

Approved work tools and assignment inspection/notes are available. Memory context
arrives through the commission; workers do not connect to memory MCP.
Claim/status/control/mail mutations are excluded from model tool
registration, including native MCP/codemode discovery. Shell and the backend
secret still make this a trusted process, **not a security sandbox**. No Telegram,
worker inbox, nested assignment creation, owner-profile preload, or memory capture runs.
The worker may use the native subagent extension for bounded research and review;
its custom types load no assignment lifecycle extension. The worker retains
responsibility for integration and its execution report. Prompt boundaries are
not sandbox guarantees.

## Project targets and shared files

Workers discover ready assignments across projects and claim each using its
explicit project and assignment ID. Project-context commands also require an
explicit project target; there is no global current-project configuration.
The runtime does not resolve workspaces or switch cwd to the project's checkout.
Commission only approved work with accessible project inputs; a discovered
mismatch or missing context is a blocker, not an automatic unclaim.

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
not automatic retry. Exiting Pi cleans up extension timers/connections without
releasing the claim; a crash may prevent cleanup. Automatic crash recovery,
age-based reclaim, and a dynamic pool remain
out of scope.
