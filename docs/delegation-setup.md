# Worker Claude Code delegation setup

Workers delegate planning, implementing and review to headless Claude Code runs through
`pi-harness-delegate@0.9.0`. Each run is a separate Claude Code session on the worker host.
See [workers](workers.md) for how a worker uses it.

## Prerequisites

- The `claude` binary on the worker's `PATH`, signed in by the host operator. This is a
  new credential: keep it private and out of releases.
- `MODEL_FOR_EASY_TASKS`, `MODEL_FOR_MEDIUM_TASKS` and `MODEL_FOR_HARD_TASKS` set to
  `anthropic/<model-id>` (for example `anthropic/claude-haiku-5-5`), using Claude Code's
  dashed ids. A tier that is unset or not Anthropic is shown to the worker as unavailable.

## Source installation

Run the normal worker setup; it installs the pinned package and creates the `implement`,
`review` and `plan` templates under the worker's private
`.pi/delegate/templates/claude/` when missing. Existing templates are left unchanged;
to pick up a source change, move the private file aside and rerun setup.

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker
```

## Permissions

Runs use the `edit` tier for implementing and `readonly` for planning and review. A
shell command Claude Code does not pre-approve (for example `npm`) is denied and the run
continues; the worker sees it in the run's permission denials and reports a blocker.
Project-level Claude settings are ignored for an untrusted workspace, so to pre-approve
commands the host operator must add them to the user-level Claude Code settings or trust
the worker workspace deliberately. `danger` is never used by workers.

## Installation checks: no model calls

```sh
command -v claude && claude --version
test -f bots/worker/.pi/npm/node_modules/pi-harness-delegate/package.json
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/implement.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/review.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/plan.md"
```

Missing output means setup is incomplete; stop rather than starting workers. For releases,
inspect the equivalent files inside the installation.

## Separate manual functional check

With normal worker authentication and a test-only assignment, confirm that the worker runs
an implement delegation, then a separate fresh review delegation with specific objectives,
and reports from their summaries. Do not use production assignments for this check.
