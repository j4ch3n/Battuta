# Worker setup

Workers are ordinary interactive Pi processes using one worker role. Each instance
has independent private authentication, model selection, sessions, and an instance
lock. Setup never launches workers or grants execution authority.

## Source checkout

Prepare the shared source profile:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure \
  --root . --role worker --env-file .env
```

The private environment needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; optional
`BATTUTA_MEMORY_URL` is loopback. Workers need no Telegram credentials. The project
CLI independently needs `LINEAR_API_TOKEN`. The intended backend must already have
assignment migrations and its Edge Function; do not reset or deploy a database as
a setup check.

Source setup prepares instructions, native settings/MCP configuration, selected
skill references, and locked shared dependencies. Worker settings select the
assignment extension, native MCP/codemode, and pinned web access.

Choose a flat private instance:

```sh
worker="$HOME/.battuta/pi-bots/worker-1"
```

The source launcher copies missing settings, generated MCP and web-search files,
rebasing resources to the source profile. It does not copy auth/model/session
files or require private instructions. Explicit fuller source configuration uses:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure \
  --root . --role worker --bot-dir "$worker"
```

This explicit source configuration preserves private preferences/custom resources;
it is not the release configuration mechanism. Extension code, dependencies and
skills remain shared with the checkout, not installed per private worker.

## Local count and tmux

Set `WORKER_BOT_COUNT=1` in `.env` for the normal local case. Both `.env` and source
`.env.prod` require a non-negative integer; `0` disables workers. `make dev` and
`make prod` give each selected worker its own labelled tmux pane, alongside the
other bots. Worker paths are `~/.battuta/pi-bots/worker-1` through worker-N.
Reattaching does not duplicate processes or resize an existing session.

Only when the operator has approved execution:

```sh
bash scripts/bot_setup/run-worker.sh --bot-dir "$worker" --env-file .env
```

The launcher uses the shared instance lock and normal Pi UI, not a custom host.
It runs from the shared checkout worker role while `PI_CODING_AGENT_DIR` selects
the intended private instance. Runtime state is not the project working directory.
The operator handles `/login` and `/model` within the intended private instance.
Never launch an additional authentication process beside a running instance or
copy another bot's authentication. Launch can immediately claim available work.

## Installed release

The release already contains generated worker instructions, compiled extensions,
and selected skills. Install-runtime installs dependencies in the installation.
All configured workers share the installed worker working directory; their
`PI_CODING_AGENT_DIR` values point at separate private `.pi/` directories.

`battuta-bot-setup configure-release --root DIR --env-file FILE` configures
CoS/Manager and worker-1 through worker-N from `WORKER_BOT_COUNT`. It creates
missing configuration and reports existing files left untouched.
Unexpected custom executable resources stop setup rather than trigger a merge.

Production uses `battuta-worker@N.service`. Unit generation does not enable or
start workers. `journalctl --user -u battuta-worker@2.service -f` views the named
worker's service output, not an interactive Pi UI or a complete transcript.

Pi UI access requires an explicit bot name and foreground-maintenance intent.
Stop the named service, verify inactivity, then use the installed `run-bot` launcher
in one tmux pane. Its instance lock refuses concurrent use. Detaching leaves Pi
running; exit Pi before separately restarting the service. The copyable operator
script and service commands are maintained in RELEASE.md.

## Non-launch validation and human acceptance

For source setup, check configuration and runtime entry points exist and run
`bash -n scripts/bot_setup/run-worker.sh`. For release setup, use installed
`battuta-packaging validate-bundle --root DIR` and inspect the configured private
MCP files without printing credentials. Missing files or invalid configuration
fail setup; do not launch Pi to diagnose them.

The human commissions an explicitly approved assignment and observes the normal
Pi UI and Manager result. This is runtime acceptance, not an agent-run setup test.
Stopping/restarting Pi does not release an unfinished assignment claim. Inspect
the authoritative assignment before deciding how to recover; do not automatically
resume/reclaim it or treat a model turn as verified task completion.
