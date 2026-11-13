# Manager delivery and worker subagents: implementation plan

> Execute with Superpowers executing-plans. The owner approved the design and
> requested immediate implementation, regular commits and a final PR push.

**Goal:** Clarify progressive delivery and install bounded worker subagents.

**Architecture:** Keep the assignment runtime and native Pi lifecycle. Role
instructions own responsibility boundaries; role-neutral skills teach methods.
Setup and packaging distribute native custom agent Markdown.

**Tech stack:** Python setup/packaging, Markdown prompts, Pi 1.3.0,
`@tintinweb/pi-subagents@0.24.0`.

**Spec:** `docs/superpowers/spec/manager-worker-delegation.md`.

## Agreed design

CoS handles lightweight work directly. Before substantial multi-step work it
explains the intention, confirms the project with the owner, and obtains start
authorization. Only an explicit start instruction together with a request not to
interrupt waives confirmation. Authorization covers later milestones within scope.

Manager enriches the commission, publishes complete assignments for the next
useful milestone, reviews results and adapts the next milestone. Discovery is
worker work too. Manager may run bounded read-only review spot-checks; workers own
implementation and formal verification. Product and authority gaps go to CoS.
Manager has no subagent extension.

Workers execute and integrate their assignment. Two custom subagent types,
researcher and reviewer, assist with bounded work and return concise evidence.
They do not intentionally edit deliverables, delegate further, claim assignments,
or send team mail. Reviewer may run tests with ordinary build/temporary outputs.
These are prompt boundaries, not sandbox guarantees.

General skills teach methods without role-specific delegation policy.
No new scheduler, assignment schema, milestone enforcement or approval machinery.

## Implementation checklist

1. Remove Manager's old package from source setup, dependencies and releases.
2. Update shared/role prompts and remove repeated policy from general skills.
3. Install pinned @tintinweb/pi-subagents for workers and ship custom definitions
   from bots/worker/agents through source and release setup.
4. Keep child extension loading separate from assignment lifecycle extensions.
5. Document setup, discovery checks and separate manual functional checks.
6. Run focused setup/packaging tests and existing relevant verification.
7. Commit logical chunks, reconcile remote branch without losing changes,
   push and update/open the PR.

## Tasks and interfaces

- [x] Task 1: Remove Manager package registration/dependency and release install.
      Files: Manager package/settings/lockfile; setup `configure.py`, `subagents.py`;
      release `bundle.py`, `runtime.py`. Verify role separation and preservation in
      `test_subagents_setup.py`, `test_configure_source.py`, `test_bundle.py`.
      Commit: `170d81d`.
- [x] Task 2: Update bot sources and general skills for authorized milestones,
      review spot-checks and bounded assistance. Root guidance defines plan/spec
      locations. No prompt-wording tests. Verify `pnpm check:skills`.
      Commit: `7396cc8`.
- [x] Task 3: Add worker custom types and pinned package. Setup exposes
      `prepare_worker_agents(source: Path, bot_dir: Path, settings: dict) -> None`;
      instance copying consumes prepared `.pi/agents`, preserving modified definitions
      through ownership fingerprints. Release copies original definitions directly.
      Tests in `test_worker_setup.py` and `test_bundle.py` first fail without package
      and definitions, then pass after implementation. Commit: `55e3846`.
- [ ] Task 4: Final review, support/worker tests, native discovery smoke check,
      remote reconciliation, verification and PR update.

## Review focus

- Private custom agent definitions must not be overwritten during reconfiguration.
- New releases and source instances must discover the same maintained types.
- Child sessions must not load assignment claims or reporting lifecycle.
- A partial setup must not silently claim installation success.
- General skills must not contradict the role prompts or demand nested assignments.

## Validation

Check package role separation, native custom-type discovery, preservation of
private/custom resources, idempotence and relocatable releases. Do not assert
prompt wording in tests. Use no production mail or live model calls in setup
checks. Live-model compliance remains a separate manual acceptance check.

## Execution record

- Manager package removal committed as `170d81d`.
- Role prompts now cover owner confirmation, authorized milestone progression,
  Manager read-only review spot-checks and bounded worker assistance.
- Worker setup/packaging regressions observed failing before implementation.
- Full bot setup: 197 passed and 48 subtests passed with `TMPDIR=/private/tmp`.
  Default macOS TMPDIR exposes three existing `/var` versus `/private/var`
  launcher assertions; canonicalizing TMPDIR avoids that environment mismatch.
- Full packaging: 55 passed and 22 subtests passed.
- Ruling: use native Markdown agent definitions plus existing setup machinery,
  not new workflow enforcement. Preserve privately modified definitions by
  refusing replacement rather than silently overwriting them.
- Fresh-context review found the worker's active-tool list omitted native
  subagent tools. Added `Agent`, `get_subagent_result`, `steer_subagent`; regression
  assertion failed before the fix and all 62 worker tests plus typecheck pass.
- Installed the pinned package in the local worker profile and verified both
  custom definitions with the installed extension's native parser. No model call,
  assignment claim or team mail was used for installation validation.
- Full `TMPDIR=/private/tmp pnpm check:support` passes; opt-in live integrations
  remain skipped. Skill validation passes. Live-model acceptance is manual.
