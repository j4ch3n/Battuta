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
  assignments to reviewed findings. Manager commissions reviews as assignments.
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

## Delegation and models

A worker's own Pi model comes from `[defaults] model` in `bots/worker/bot.toml`
([bot setup](bot-setup.md)). Each assignment's difficulty (`easy` by default, `medium`,
`hard`, `hail_mary`) is the Manager's advice only; it does not select a model.

The worker delegates planning, implementing and reviewing to headless Claude Code runs
(see [delegation setup](delegation-setup.md)) and decides each run's mode, model tier
(`economy`, `balanced` or `max`), scope and objective. A session-start prompt section lists
the tiers from `MODEL_FOR_EASY_TASKS`, `MODEL_FOR_MEDIUM_TASKS` and `MODEL_FOR_HARD_TASKS`
(`anthropic/<model-id>`); hail-mary work also uses `max`. A tier whose variable is unset
or not Anthropic is shown as unavailable. The worker reads each run's summary, resumes a
session only when the objective continues, and starts a fresh session for review.

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

Installed releases instead use the selected compiled `bots/worker` or
`bots/worker-influencer` profile as cwd and
`~/.battuta/pi-bots/worker-N/.pi` as agentDir. Build-generated instructions/skills
and installed dependencies stay in the installation; private configuration is
generated separately without resource merges. `BATTUTA_WORKER_<N>_TYPE` selects the
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

Before subscribing, the extension validates launcher-provided
`BATTUTA_WORKER_CAPABILITIES` JSON and initializes an immutable capability set.
The launcher supplies the configured bot ID (`worker-N`) in `AGENT_ID`, alongside `AGENT_ROLE=worker`; claims record
that name as `claimed_by` for traceability. A missing or invalid name stops startup
rather than inventing an ID. Bot names must be distinct wherever operators need
to distinguish workers across hosts.
The launcher resolves base plus selected type capabilities from `bot.toml`;
see [manifest configuration](bot-setup.md#worker-capabilities).
Each fresh Pi runtime reloads the same configuration without a model turn.
Missing, malformed or unknown capabilities stop startup before network access.
Availability signals, reconnects and fallback checks drive matching and claiming
in code. No registration tool or model declaration exists. The first execution
turn follows a confirmed claim, prepared workspace and persisted TODO start.
Configuration changes require a restart; restored claims still require the full
configured subset.

After claiming and safely preparing the local scratch workspace, `newSession`
starts a fresh conversation at the same cwd/agentDir.
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
Claim/status/control mutations are excluded from model tool
registration, including native MCP/codemode discovery. Workers keep
`send_agent_message` and `reply_agent_message` (Manager-only routing, see
[agent mail](agent-mail.md)); `delegate` is active where its package is installed and runs in the assignment project's folder or worktree (see [delegation setup](delegation-setup.md)). Shell and the backend
secret still make this a trusted process, **not a security sandbox**. No Telegram,
worker inbox, nested assignment creation, owner-profile preload, or memory capture runs.
The worker's custom types load no assignment lifecycle extension. The worker retains
responsibility for integration and its execution report. Prompt boundaries are
not sandbox guarantees.

## Project targets and shared files

Workers discover ready assignments across projects and claim each using its
explicit project and assignment ID. Project-context commands also require an
explicit project target; there is no global current-project configuration.
The runtime does not switch cwd or provision a project checkout. It creates only
missing `~/.battuta/projects/<project>/work/<assignment-id>/note.md` scratch paths,
without changing existing note bytes. It verifies the live claim before preparation,
and prepares once per session binding, including a fresh restoration, not before
each TODO or note edit. Workspace paths have a trusted single writer. Unsafe paths or creation
failures become claim-bound blockers; an unconfirmed blocker retains the claim
and pauses. Preparation does not register a project, create `project.yaml` or a
summary, clone code, restore essential inputs, or synchronize files.
Commission only approved work with accessible project inputs; a discovered
mismatch or missing context is a blocker, not an automatic unclaim.
The executing worker checks essential inputs in the commission; directory
readiness alone is not evidence those inputs exist. Note-only work needs no
registered project when its supplied inputs are sufficient.

Concurrent workers may share project files. Manager must choose non-conflicting
boundaries or dependencies. No locking or file synchronization is added; missing
local input must be reported honestly rather than assumed to exist elsewhere.
The bound execution message includes the resolved local workspace paths.
Shared note tools return full local paths resolved for the calling bot;
old absolute metadata must never be used as a local write target. Persist complete
handoff content in TODO results; local notes alone are not cross-host evidence.

## Notification and manual operations

After confirmed done/blocked persistence, the extension sends one chat from
the worker's bot name to the `manager` mailbox, using the assignment conversation UUID. Mail contains
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
