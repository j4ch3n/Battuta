# Worker setup

Workers are ordinary interactive Pi instances with the same worker profile and
assignment extension. Prepare the shared profile once, then copy its configuration
into each private instance. Setup never launches a worker or grants execution
authority. The operator launches and tests Pi separately.

## Prerequisites

- Source checkouts need the repository's Node/pnpm versions and Python 3.12+ with
  uv. Releases bundle Node and runtime dependencies; Python/uv support setup.
- The intended backend must already have the assignment migrations and Edge
  Function. Do not reset a developer database or deploy as a setup check.
- Provision the shared memory service and existing project/artifact CLIs before
  commissioned work. All workers operate on the same current project; setup does
  not change it.
- A private shell-compatible `.env` (source) or `.env.prod` (release) contains
  `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; optional `BATTUTA_MEMORY_URL` defaults
  to loopback HTTP. Never print secrets or enable shell tracing. Worker setup
  needs neither Telegram nor Linear credentials. Project-context CLI operations
  may independently need `LINEAR_API_TOKEN`.

## Prepare the shared profile

From the source root:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure \
  --root . --role worker --env-file .env
```

From an installed release:

```sh
bin/battuta configure-worker
```

This prepares `bots/worker/AGENTS.md`, `.pi/settings.json`, and `.pi/mcp.json`.
The manifest selects native skill paths into the shared catalog. Settings register
`bots/worker/extension/assignment-worker/index.ts`, native MCP/codemode, and shared
research tools. Source setup installs locked shared dependencies; releases use
their staged dependencies. No custom host or runtime manifest loader is involved.

## Initialize a private instance

Choose a unique directory for each process:

```sh
worker="$HOME/.battuta/worker/worker-1"
```

From source:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure \
  --root . --role worker --bot-dir "$worker"
```

From an installed release:

```sh
bin/battuta configure-worker --bot-dir "$worker"
```

Initialization copies the prepared instructions and settings/MCP configuration,
plus `web-search.json` if present. Native resource paths are resolved to the
shared installation; dependencies, extension code, and the skill catalog are not
copied per instance. Authentication, model registries, sessions, mail state, and
caches are never copied. Explicit reconfiguration preserves private settings and
custom resources, merges the shared resources, and leaves existing instructions
intact. Do not keep instance-specific changes in the shared profile.

The launcher can initialize an absent instance from the prepared profile too.
It leaves an existing complete instance unchanged and rejects a partial profile;
configure a partial profile explicitly before launching. If the shared installation
moves, explicitly reconfigure instances to resolve its new resource paths.
Owned references from the previous installation are replaced, not added alongside
the new ones; unrelated custom resources remain intact.

## Authenticate and choose a model — operator only

Before commissioning work, use Pi's normal `/login` and `/model` commands from
the private instance. For login without assignment discovery, disable extensions
and skills for this invocation only. From source, after setting `worker` above:

```sh
cli="$PWD/bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
(cd "$worker" && PI_CODING_AGENT_DIR="$worker/.pi" node "$cli" --no-extensions --no-skills)
```

For a release, use the same `cli` path relative to its root and replace `node`
with the absolute path to that release's `bin/node`. Exit after login/model
selection without entering a work prompt. Never copy another bot's auth/session
files. This interactive operator step is not an agent-run setup check.

## Validate without launching Pi

From the source or release root, with `worker` pointing to the private instance:

```sh
set -eu
test -s "$worker/AGENTS.md"
test -s "$worker/.pi/settings.json"
test -s "$worker/.pi/mcp.json"
runtime="$PWD/bots/worker/extension/assignment-worker"
test -f "$runtime/index.ts"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js"
test -f "$runtime/node_modules/pi-web-access/package.json"
bash -n scripts/bot_setup/run-worker.sh
```

Every check must exit zero. Stop on a missing prerequisite; do not launch a worker
to investigate setup. These checks do not prove provider authentication, backend
connectivity, terminal behavior, or task correctness.

## Launch and manual acceptance — operator only

Launch can immediately claim available work. Commission only an explicitly
approved test assignment/project, and do not start another process for an already
running instance. From source:

```sh
bash scripts/bot_setup/run-worker.sh --bot-dir "$worker" --env-file .env
```

From an installed release:

```sh
bin/battuta worker --bot-dir "$worker"
```

Expect the normal Pi terminal interface, not a JSON stream or a custom shell.
The extension reads/claims an eligible assignment without a model call, creates a
fresh conversation in the same process/cwd/private profile, then delivers its
TODO message and triggers a turn. Ordered TODOs share that assignment conversation.
Pi owns prompt execution, retries, error display, and normal operator interaction;
no prompt-failure injection or automatic recovery test is required.

The user performs this runtime test and provides feedback. Report the command
used, any visible sanitized error, whether the assignment was claimed, and whether
its conversation and turn started. Do not share auth files, secrets, or raw private
session dumps. A triggered turn is not recorded assignment success.

Sessions stay under the instance's `.pi/sessions/`. The launcher does not
automatically resume a previous conversation. Interrupting/exiting Pi does not
release an unfinished claim; inspect it before any manual recovery or restart.
No pool or automatic takeover is installed. Source setup does not install a
worker service.

## Release user service

`bin/battuta install-services` also writes `battuta-worker.service`, without
starting or enabling it. The unit runs the normal worker launcher under a PTY,
using that release's `bots/worker` as its private instance. Prepare or retain its
configuration before starting it. Do not run another process for that profile.

Follow [release setup](../RELEASE.md) to stop the old deployment, retain private
configuration, install all three bot services, and switch their release paths.
`install-services --replace` explicitly replaces regular unit files; it refuses
symlinks and leaves systemd drop-ins unchanged. Check customizations before use.

Only enable/start the worker after owner approval to execute available work.
The owner handles authentication, model access, and functional acceptance; service
status alone does not establish readiness. Stop the service before opening its
profile interactively. Inspect unfinished claims before interrupting or restarting
the worker; supervision does not add automatic claim recovery.
