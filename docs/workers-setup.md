# Worker setup

Prepare each private worker directory separately. Setup does not launch a worker,
message a bot, run a model, or grant execution authority. Start only an explicitly
approved fixed number of workers, all commissioned for the same current project.

## Prerequisites

- Use the repository's Node/pnpm versions and Python 3.12+ with uv for source setup.
  Releases include Node and runtime packages; Python/uv are needed for setup tools.
- The assignment migrations and Edge Function must already be installed on the
  intended backend. Do not reset a developer database or deploy as a setup check.
- Provision shared memory using its own installation guidance in the release setup
  index. Existing project/artifact CLIs must be available for commissioned work.
- A private shell-compatible environment file must contain `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY`; optional `BATTUTA_MEMORY_URL` defaults to loopback HTTP.
  Do not display secrets or enable shell tracing. Worker setup requires neither
  Telegram nor Linear credentials. The unchanged project CLI may independently
  require `LINEAR_API_TOKEN`; without needed context/tools, execution blocks.

## Configure

Create the private directory if absent; do not overwrite an existing instance.
From the source root:

```sh
mkdir -p "$HOME/.battuta/workers/worker-1"
uv run --project scripts/bot_setup --locked battuta-bot-setup configure \
  --root . --role worker --bot-dir "$HOME/.battuta/workers/worker-1" --env-file .env
```

From an installed release:

```sh
mkdir -p "$HOME/.battuta/workers/worker-1"
bin/battuta configure-worker --bot-dir "$HOME/.battuta/workers/worker-1"
```

The release command defaults to its private `.env.prod`. Source configuration
installs shared locked dependencies and selected research tools under the shared
worker runtime, not each instance. Release configuration uses the already-staged
runtime. Source instances get manifest-selected local discovery links; releases
use native skill paths into one shared catalog without per-instance catalog copies.
Both use ordinary native settings paths for the pinned Pi MCP/codemode extensions.
Custom skills/auth/session state are preserved; conflicting owned skill links fail.

Authenticate the model provider and select its model using Pi's ordinary CLI with
`PI_CODING_AGENT_DIR` set to this instance's absolute `.pi`, from the instance cwd.
Use the shared runtime's `node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`.
The owner may use `/login` and `/model`, then exit without entering a prompt. This
generic CLI does not load the host's assignment coordinator. Never copy another
bot's private auth/session files or make a model request as a setup check.

## Validate without execution

Set `worker` to the existing absolute instance directory and `runtime` to the
existing absolute `assignment-worker` package directory. Run with shell tracing
off and the intended environment loaded privately:

```sh
set -eu
test -s "$worker/AGENTS.md"
test -s "$worker/.pi/settings.json"
test -s "$worker/.pi/mcp.json"
test -s "$worker/.pi/auth.json"
test -f "$runtime/host.ts"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js"
(cd "$worker" && PI_CODING_AGENT_DIR="$worker/.pi" node "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" mcp list)
```

All checks must exit zero. MCP diagnostics must show assignments and read-only
memory connected; credential values must not be printed. A failed check stops
setup: report the missing prerequisite to the operator rather than starting the
host to see whether it works. These checks do not prove model authentication,
task correctness, hardware suitability, or product acceptance.

## Launch only after authorization

Keep one process per instance. Source:

```sh
bash scripts/bot_setup/run-worker.sh --bot-dir "$HOME/.battuta/workers/worker-1" --env-file .env
```

Installed release:

```sh
bin/battuta worker --bot-dir "$HOME/.battuta/workers/worker-1"
```

The launcher exports worker role/private agentDir, strips Telegram/scheduler
variables, and starts one persistent foreground host. It never uses `--print` or
automatic session continuation. SIGINT/SIGTERM stops the host without releasing
an unfinished claim. Do not launch a duplicate as crash recovery; inspect the
ledger and process state first. No worker service/pool is installed automatically.
