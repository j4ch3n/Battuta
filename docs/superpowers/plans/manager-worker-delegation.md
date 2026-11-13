# Manager delivery and worker subagents: implementation plan

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
