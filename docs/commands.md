# Command reference

Run source-checkout commands from the repository root. See [development](../.agents/skills/battuta-setup/references/development.md) for prerequisites and environment configuration, and [code checks](../.agents/skills/battuta-verify/references/checks.md) for test discovery and CI.

## Make targets

| Command                                  | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `make help`                              | List supported commands                                     |
| `make setup-checks`                      | Install locked contributor dependencies and Git hooks       |
| `make format`                            | Format repository-owned files                               |
| `make check`                             | Format, lint, types, unit tests, and supporting-code checks |
| `make check-all`                         | All checks, including isolated Supabase integration         |
| `make db-diff NAME=name`                 | Generate a migration from local schema changes              |
| `make functions-serve`                   | Serve Edge Functions using `supabase/.env`                  |
| `make setup-bot`                         | Configure both bots and install dependencies                |
| `make setup-pm-bot`, `make setup-tl-bot` | Configure one bot                                           |
| `make refresh-telegram ENV_FILE=.env`    | Update both Telegram profiles from the selected file        |
| `make dev`                               | Attach PM, TL, and local functions; bots use `.env`         |
| `make prod`                              | Attach PM and TL; bots use `.env.prod`                      |

`make refresh-telegram` defaults to `.env`; `ENV_FILE` can select `.env.prod` or any other file path. It updates each bot's `.pi/telegram.json`, including the token, derived bot ID, allowed user ID, and optional username, without launching or restarting bots. Restart running bots separately to use refreshed settings.

`make dev` and `make prod` only launch or attach; an existing tmux session is reattached without reloading settings. Dev functions use `supabase/.env` separately.

## Script entry points

- Root `package.json` defines individual formatting, Node/Deno lint and type checks, unit tests, coverage, integration tests, and supporting checks. The [code-check reference](../.agents/skills/battuta-verify/references/checks.md) lists their invocations.
- `scripts/checks/check-deno.mjs` discovers each function's `lint`, `check`, or `test` task.
- `scripts/checks/check-supabase.mjs` manages isolated Supabase integration checks, migrations, database permissions tests, and Node integration tests; diagnostics are retained in the printed `/tmp/battuta-check-reports-*` directory.
- `scripts/checks/check-support.mjs` validates packaging JavaScript and shell syntax and runs the focused Python tests under `scripts/tests/`, service packages, and `project-context-cli/tests/`, using the corresponding package's locked environment.
- `scripts/checks/lint-staged-code.mjs` applies runtime-specific linting to staged code through lint-staged/Husky.
- `bots/{pm-bot,tl-bot}/scripts/configure-bot.py` generates bot instructions and runtime configuration; use `uv run --locked python <script-path> --help` for options.
- `bots/pm-bot/scripts/run-dev.sh` implements the `dev` and `prod` tmux launch modes.
- `scripts/refresh-telegram.py` validates and refreshes both Telegram profiles without reinstalling packages or regenerating instructions.
- `battuta-project` manages project initialization, selection, context indexes, and GitHub/Linear association. See the [project-context skill](../skills-hub/project-context/SKILL.md) and its [command reference](../skills-hub/project-context/references/commands.md). TODO implementation details live in [execution TODO persistence](project-todos.md).
- MCP memory tools manage shared project/global memory through the [memory skill](../skills-hub/memory/SKILL.md) and its role-specific workflows; see [runtime behavior](memory-service.md). Source provisioning uses `bash scripts/setup-memory.sh`; the service command is `memory-service/.venv/bin/battuta-memory serve`.
- `pnpm check:skills` validates all runtime skill manifests. The commit hook checks staged selections; release builds check before assembly. See [skill management](skill-management.md) for the naming, selection, and lifecycle contract.
- Release launcher, configuration, and service commands are documented in [release setup](../RELEASE.md); their implementations live in `packaging/`.
