# Command reference

Run source-checkout commands from the repository root. See [development](../.agents/skills/battuta-setup/references/development.md) for prerequisites and environment configuration, and [code checks](../.agents/skills/battuta-verify/references/checks.md) for test discovery and CI.

## Make targets

| Command                                        | Purpose                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `make help`                                    | List supported commands                                      |
| `make setup-checks`                            | Install locked contributor dependencies and Git hooks        |
| `make format`                                  | Format repository-owned files                                |
| `make check`                                   | Format, lint, types, unit tests, and supporting-code checks  |
| `make check-all`                               | All checks, including isolated Supabase integration          |
| `make db-diff NAME=name`                       | Generate a migration from local schema changes               |
| `make functions-serve`                         | Serve Edge Functions using `supabase/.env`                   |
| `make setup-bot`                               | Configure both bots and install dependencies                 |
| `make setup-cos-bot`, `make setup-manager-bot` | Configure one bot                                            |
| `make refresh-telegram ENV_FILE=.env`          | Update CoS Telegram from the selected file                   |
| `make dev`                                     | Attach CoS, Manager, Worker, and local services using `.env` |
| `make prod`                                    | Attach CoS and Manager; bots use `.env.prod`                 |

`make refresh-telegram` defaults to `.env`; `ENV_FILE` can select `.env.prod` or another path. It updates only CoS's `.pi/telegram.json` without launching or restarting bots. Manager has no Telegram configuration. Source setup also generates ignored manifest-selected local skill links; releases carry selections as metadata beside one shared catalog.

`make dev` and `make prod` only launch or attach; an existing tmux session is reattached without reloading settings. Dev functions use `supabase/.env` separately.

`make dev` uses two tmux windows: `bots` has CoS, Manager, and one Worker in three equal columns; `services` has shared memory and Edge Functions in two equal columns. The worker launcher creates `$HOME/.battuta/workers/worker-1/.pi` and copies missing settings, generated MCP configuration, and `web-search.json` from `bots/worker`; existing private files are preserved, and auth/instruction files are not required to open Pi (see [worker setup](workers-setup.md)). Missing shared MCP configuration stops launch with its setup command. The worker pane is the ordinary interactive Pi CLI with its worker-only extension, not a custom host. Supabase must already be running; the launcher serves functions without starting or restarting the database. Logins and model selections are preserved. Worker runtime testing is operator-run, separate from non-launch setup/check commands.

## Script entry points

- Root `package.json` defines individual formatting, Node/Deno lint and type checks, unit tests, coverage, integration tests, and supporting checks. The [code-check reference](../.agents/skills/battuta-verify/references/checks.md) lists their invocations.
- `scripts/checks/check-deno.mjs` discovers each function's `lint`, `check`, or `test` task.
- `scripts/checks/check-supabase.mjs` manages isolated Supabase integration checks, migrations, database permissions tests, and Node integration tests; diagnostics are retained in the printed `/tmp/battuta-check-reports-*` directory.
- `scripts/checks/check-support.mjs` checks shell syntax and runs each Python package's tests through its own locked uv environment. Setup and packaging tests live under their owning projects; all test workspaces use `/tmp`.
- `scripts/checks/lint-staged-code.mjs` applies runtime-specific linting to staged code through lint-staged/Husky.
- `uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role cos` generates bot instructions and runtime configuration; use `--role manager` for Manager or `configure --help` for workspace/environment overrides.
- `scripts/bot_setup/run-dev.sh` implements the shared `dev` and `prod` tmux launch modes.
- `uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker` prepares the shared worker profile; add `--bot-dir DIRECTORY` to copy it into a private instance without installing dependencies there. `bash scripts/bot_setup/run-worker.sh --bot-dir DIRECTORY [--env-file FILE]` launches ordinary interactive Pi with the assignment extension. Releases expose `bin/battuta configure-worker` for the shared profile, `bin/battuta configure-worker --bot-dir DIRECTORY` for an instance, and `bin/battuta worker --bot-dir DIRECTORY` for operator launch. See [worker runtime](workers.md); installation is indexed from RELEASE.md.
- `make refresh-telegram ENV_FILE=.env` calls the setup package's `refresh-telegram` command to update both profiles without reinstalling packages or regenerating instructions.
- `battuta-project` manages project initialization, selection, context indexes, and GitHub/Linear association. See the [project-context skill](../skills-hub/project-context/SKILL.md) and its [command reference](../skills-hub/project-context/references/commands.md). Shared assignment/TODO MCP and local note mechanics live in [assignment runtime](assignments.md); no task or note-editing CLI is required.
- `pnpm test:assignments:local` verifies assignment database/MCP behavior against an already running local Supabase instance without resetting or stopping it; it requires additive migrations applied and the function already served. The isolated `pnpm test:integration` path remains the CI/default cross-system check.
- MCP memory tools manage shared project/global memory through the [memory skill](../skills-hub/memory/SKILL.md) and its role-specific workflows; see [runtime behavior](memory-service.md). Source provisioning uses `bash scripts/setup-memory.sh`; the service command is `memory-service/.venv/bin/battuta-memory serve`.
- `pnpm check:skills` validates all runtime skill manifests. The commit hook checks staged selections; release builds check before assembly. See [skill management](skill-management.md) for the naming, selection, and lifecycle contract.
- Release assembly and service installation live in `scripts/packaging/`, an independent uv project that reuses `scripts/bot_setup/`. Use `uv run --project scripts/packaging --locked battuta-packaging --help`; installed commands are documented in [release setup](../RELEASE.md).
