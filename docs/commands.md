# Command reference

Run source-checkout commands from the repository root. See [development](../.agents/skills/battuta-setup/references/development.md) for prerequisites and environment configuration, and [code checks](../.agents/skills/battuta-verify/references/checks.md) for test discovery and CI.

## Make targets

| Command                                        | Purpose                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `make help`                                    | List supported commands                                                     |
| `make setup-checks`                            | Install locked contributor dependencies and Git hooks                       |
| `make format`                                  | Format repository-owned files                                               |
| `make check`                                   | Format, lint, types, unit tests, and supporting-code checks                 |
| `make check-all`                               | All checks, including isolated Supabase integration                         |
| `make db-diff NAME=name`                       | Generate a migration from local schema changes                              |
| `make functions-serve`                         | Serve Edge Functions using `supabase/.env`                                  |
| `make setup-bot`                               | Configure both bots and install dependencies                                |
| `make setup-cos-bot`, `make setup-manager-bot` | Configure one bot                                                           |
| `make refresh-telegram ENV_FILE=.env`          | Update CoS Telegram from the selected file                                  |
| `make dev`                                     | Attach CoS, Manager, Worker, and local services using `.env`                |
| `make prod`                                    | Attach source CoS, Manager, configured workers and memory using `.env.prod` |

`make refresh-telegram` defaults to `.env`; `ENV_FILE` can select `.env.prod` or another path. It updates only CoS's `.pi/telegram.json` without launching or restarting bots. Manager has no Telegram configuration. Source setup generates ignored manifest-selected local skill links; releases ship complete selected skills per role, without a catalog.

`make dev` and `make prod` only launch or attach; an existing tmux session is reattached without reloading settings. Dev functions use `supabase/.env` separately.

Before configuring CoS, stop it and set the required `BATTUTA_DREAM_MODEL=provider/model-id` in the selected environment file. Bot `bot.toml` files provide initial private model/thinking defaults only when settings are missing; see [bot setup manifests](bot-setup.md). CoS setup provisions the nightly dream independently; see [memory setup](memory-service-setup.md#nightly-cos-dream-setup).

`WORKER_BOT_COUNT` is required in both source environment files: `0` selects no
workers, `1` is the normal local setting, and `N` selects worker-1 through worker-N.
Each bot gets its own tmux pane. Worker state uses
`$HOME/.battuta/pi-bots/worker-N/.pi`. `make dev` retains the `services` window for
memory and Edge Functions; Supabase must already be running. Worker launch waits
for assignment-route readiness. Existing sessions reattach without resizing or
duplicating processes; invalid counts fail even before reattach. Human runtime
acceptance is separate from setup checks.

## Script entry points

- Root `package.json` defines individual formatting, Node/Deno lint and type checks, unit tests, coverage, integration tests, and supporting checks. The [code-check reference](../.agents/skills/battuta-verify/references/checks.md) lists their invocations.
- `scripts/checks/check-deno.mjs` discovers each function's `lint`, `check`, or `test` task.
- `scripts/checks/check-node.mjs <component-directory>` installs and checks one Node component, including its required local dependencies, with unit coverage where available.
- `scripts/checks/select-checks.mjs [--full] [BASE HEAD]` selects affected CI components from a Git comparison. With no comparison, or with `--full`, it selects the full suite. See [CI selection](../.agents/skills/battuta-verify/references/checks.md#ci-selection).
- `scripts/checks/check-supabase.mjs` manages isolated Supabase integration checks, migrations, database permissions tests, and Node integration tests; diagnostics are retained in the printed `/tmp/battuta-check-reports-*` directory.
- `scripts/checks/check-support.mjs [scripts|memory-service|artifact-service|project-context-cli ...]` runs selected groups through their locked uv environments; no arguments runs all groups. `scripts` includes shell syntax, setup, and packaging tests. All test workspaces use `/tmp`.
- `scripts/checks/lint-staged-code.mjs` applies runtime-specific linting to staged code through lint-staged/Husky.
- `uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role cos` generates bot instructions and runtime configuration; use `--role manager` for Manager or `configure --help` for workspace/environment overrides.
- `scripts/bot_setup/run-dev.sh` implements the shared `dev` and `prod` tmux launch modes.
- `battuta-bot-setup agent-dir --root DIR --bot cos-bot|manager-bot|worker-N` prints the manifest-derived absolute `PI_CODING_AGENT_DIR` without creating files. `run-source --root DIR --bot cos-bot|manager-bot --env-file FILE` is the source tmux launch boundary; it initialises missing preferences but does not override saved model choices.
- `uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker` prepares the source worker profile; add `--bot-dir DIRECTORY` for explicit source-instance configuration. `bash scripts/bot_setup/run-worker.sh --bot-dir DIRECTORY [--env-file FILE]` launches ordinary interactive Pi under the instance lock. Release configuration uses installed `battuta-bot-setup configure-release --root DIR --env-file FILE`; installed `battuta-packaging run-bot` requires explicit bot, Node, environment and launch mode. See [worker runtime](workers.md).
- `make refresh-telegram ENV_FILE=.env` calls the setup package's `refresh-telegram` command to update CoS's Telegram configuration without reinstalling packages or regenerating instructions.
- `battuta-project` manages project initialization, context indexes, and GitHub/Linear association with explicit project targets. `list --json` exposes read-only structured discovery under the fixed `~/.battuta/projects` root; there is no shared project selection or root override. Run `battuta-project --help` for commands. Shared assignment/TODO MCP and local note mechanics live in [assignment runtime](assignments.md); no task or note-editing CLI is required.
- `pnpm test:assignments:local` verifies assignment database/MCP behavior against an already running local Supabase instance without resetting or stopping it; it requires additive migrations applied and the function already served. The isolated `pnpm test:integration` path remains the CI/default cross-system check.
- The CoS memory extension and isolated recall agent manage shared project/global memory; see [runtime behavior](memory-service.md) and [tool reference](memory-tools.md). Source provisioning uses `bash scripts/setup-memory.sh`; the service command is `memory-service/.venv/bin/battuta-memory serve`.
- `pnpm check:skills` validates all runtime skill manifests. The commit hook checks staged selections; release builds check before assembly. See [skill management](skill-management.md) for the naming, selection, and lifecycle contract.
- Release tooling lives in `scripts/packaging/`, an independent uv project reusing bot setup. `battuta-packaging stage-bots`, `build-wheels`, `extract-bots`, `validate-bundle`, `install-runtime`, `install-services`, `run-bot`, and `run-component` separate build, setup, and runtime responsibilities; use each command's `--help`. CI builds in pinned Oracle Linux 9 ARM64 userspace and verifies candidate artifacts before promotion. Wheels carry lock-derived dependency metadata, without separate constraints. The opt-in `release_install.it.py` checks actual artifacts in isolated tool environments; ordinary support tests stub external boundaries. No verification invokes models or starts bots.
