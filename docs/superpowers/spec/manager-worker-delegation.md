# Manager delivery and worker subagent design

## Roles and authority

CoS handles lightweight searches, explanations, clarification and file organization
within its authority. Before substantial multi-step work, it explains the
intention, double-checks the project with the owner and obtains start authorization.
Only an explicit start instruction together with a request not to interrupt
waives confirmation. Missing project or authority must not be invented.

Authorization covers later milestones within scope. Manager enriches the
commission, creates complete assignments for the next useful milestone, reviews
results and adapts subsequent work. Discovery, implementation and formal checks
go through assignment workers. Manager may perform bounded read-only review
spot-checks and directly maintain managerial records. Product intent, material
scope changes and authority gaps return to CoS. Manager has no subagent extension.

## Worker assistance

Workers execute most work themselves and retain integration, evidence judgment
and execution reporting. Researcher and reviewer custom types return bounded
findings rather than intermediate exploration. Researcher gets inspection and web
tools; reviewer gets inspection and shell tools for checks. Neither intentionally
edits deliverables, claims assignments, sends team mail or delegates further.
Normal test/build outputs are acceptable. These are prompt boundaries, not a
sandbox or runtime workflow enforcement.

## Installation and maintenance

Pin `@tintinweb/pi-subagents@0.24.0` for workers with Pi 1.3.0. Maintain custom
types under `bots/worker/agents/` and expose them through native discovery for both
source instances and releases. Keep child extension loading separate from the
assignment lifecycle. Preserve private authentication and custom resources.
Setup checks use files/CLI only; live-model acceptance is separate.

## Non-goals

No new scheduler, assignment schema, milestone state machine, approval enforcement,
general-purpose project bucket, recursive child delegation or implementer type.
General skills remain methods, not role-specific delegation rules.
