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
  commissioned work. Each assignment names its project explicitly; setup does
  not select a project. Workers discover ready assignments across projects.
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
`npm:pi-web-access@0.43.0`. Source setup installs locked shared dependencies;
releases use their staged dependencies. Pi manages the npm package installation.
The profile's `web-search.json` supplies the same mobile browser user-agent as
CoS and Manager. No custom host or runtime manifest loader is involved.

## Choose a private instance

Choose a unique directory for each process:

```sh
worker="$HOME/.battuta/workers/worker-1"
```

No instance pre-setup is required to open Pi. After shared profile preparation,
the launcher creates the private `.pi` directory and copies missing `settings.json`,
generated `mcp.json`, and `web-search.json`, resolving settings resource paths against the source
profile. It preserves existing files and never requires or copies `AGENTS.md` or
`auth.json`. Pi handles login and private runtime state during interactive use.
If the instance needs MCP configuration but the shared file is missing, launch
stops with the shared worker-configuration command; it never invents endpoints.

### Optional full profile configuration

For Battuta instructions and explicit configuration refreshes, configure the
instance. The shared MCP file comes from `configure_worker()` through `mcp.py`,
including worker-specific tool restrictions; Pi does not generate those endpoints.
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

The launcher never runs full profile configuration implicitly. For fully configured
instances, explicit reconfiguration replaces tracked owned references from the
previous installation, preserving unrelated custom resources.

## Authenticate and choose a model — operator only

You can launch directly and use Pi's normal `/login` and `/model` commands;
an existing auth file is not a launch prerequisite. Before commissioning work,
finish authentication and configure any required MCP services. For login without assignment discovery, disable extensions
and skills for this invocation only. From source, after setting `worker` above:

```sh
cli="$PWD/bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
mkdir -p "$worker/.pi"
(cd "$worker" && PI_CODING_AGENT_DIR="$worker/.pi" node "$cli" --no-extensions --no-skills)
```

For a release, use the same `cli` path relative to its root and replace `node`
with the absolute path to that release's `bin/node`. Exit after login/model
selection without entering a work prompt. Never copy another bot's auth/session
files. This interactive operator step is not an agent-run setup check.

## Validate without launching Pi

From the source or release root, check the shared resources before first launch:

```sh
set -eu
test -s bots/worker/.pi/settings.json
test -s bots/worker/.pi/mcp.json
test -s bots/worker/.pi/web-search.json
runtime="$PWD/bots/worker/extension/assignment-worker"
test -f "$runtime/index.ts"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js"
test -f "$runtime/node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js"
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
