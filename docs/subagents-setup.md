# Worker subagent setup

Workers use `@tintinweb/pi-subagents@0.24.0` with Pi 1.3.0. Manager uses assignment
workers, not this extension. There is no Battuta child runtime or new credential.

## Source installation

From the repository root, prepare the shared worker profile:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker
```

Setup installs the pinned extension and copies maintained definitions from
`bots/worker/agents/` to the native `.pi/agents/` discovery directory.
It also prepares a real copy of `research` and its references under
`bots/worker/.pi/skills/research/`: native subagent preloading does not follow
catalog links or Pi's configured skill paths. Setup creates missing files and
leaves existing files unchanged. To pick up a source change, first move or remove
the corresponding prepared file, then rerun setup.
Reconfigure existing instances explicitly:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker --bot-dir "$HOME/.battuta/pi-bots/worker-1"
```

Repeat for each configured worker. Stop workers before maintenance and restart
afterward. Setup preserves private authentication and unrelated custom resources.
Existing definitions, including private customizations, are left unchanged.

## Installed releases

Release builds copy definitions to `bots/worker/.pi/agents/`. The normal release
`install-runtime` step installs the pinned package; workers discover definitions
from the installed role directory. No manual agent-file copy or separate child
login is needed. Authenticate in the worker's normal Pi environment; do not copy
private authentication into a release or child folder.

## Types and context

- `researcher` uses local inspection and the installed web-access extension.
- `reviewer` uses inspection tools and shell commands for requested checks.

Both use standalone prompts, no inherited conversation or ambient skills, and no
further delegation. The researcher explicitly preloads only `research`; the
reviewer preloads no skills. Only the researcher loads web access; neither loads the assignment
worker lifecycle extension. Worker instructions explain when to use each type;
the extension supplies native `Agent` tool help.

These are trusted processes, not a sandbox. Subagents return findings to their
parent rather than completing its assignment; shell/environment access is not
a security boundary. The parent finishes needed child work before reporting its
TODO complete and reviews evidence rather than treating child completion as
assignment completion.

## Installation checks: no model calls

```sh
test -f bots/worker/.pi/npm/node_modules/@tintinweb/pi-subagents/package.json
test -f bots/worker/.pi/agents/researcher.md
test -f bots/worker/.pi/agents/reviewer.md
test -f bots/worker/.pi/skills/research/SKILL.md
test -f bots/worker/.pi/skills/research/references/investigation.md
```

Inspect the package version and both definitions, then verify instance copies
under `$HOME/.battuta/pi-bots/worker-N/.pi/agents/`. For releases, inspect the
equivalent files inside the installation. Missing files or an incorrect version
mean setup is incomplete; stop rather than starting workers.

## Separate manual functional checks

With a test-only assignment and normal worker authentication, ask a researcher
for a bounded source-backed answer and a reviewer to run a harmless local test.
Confirm the custom types resolve, web tools work, reviewer reports actual
commands/results, and neither starts an assignment coordinator or registers
`report_execution_result`. Confirm the parent integrates their evidence and only
the bound worker reports execution once. Do not use production assignments or
send production mail merely to validate installation.
