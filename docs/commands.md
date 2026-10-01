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
| `make start-dev`                         | Attach PM, TL, and functions panes; requires local Supabase |
| `make start-prod`                        | Attach both bots using remote Supabase and `.env.prod`      |
| `make run-dev`                           | Alias for `make start-dev`                                  |

## Script entry points

- Root `package.json` defines individual formatting, Node/Deno lint and type checks, unit tests, coverage, integration tests, and supporting checks. The [code-check reference](../.agents/skills/battuta-verify/references/checks.md) lists their invocations.
- `scripts/check-deno.mjs` discovers each function's `lint`, `check`, or `test` task.
- `scripts/check-supabase.mjs` manages isolated Supabase integration checks, migrations, database permissions tests, and Node integration tests.
- `scripts/check-support.mjs` validates packaging JavaScript and shell syntax.
- `scripts/lint-staged-code.mjs` applies runtime-specific linting to staged code through lint-staged/Husky.
- `bots/{pm-bot,tl-bot}/scripts/configure-bot.py` generates bot instructions and runtime configuration; use `uv run --locked python <script-path> --help` for options.
- `bots/pm-bot/scripts/run-dev.sh` implements the `dev` and `prod` tmux launch modes.
- Shared project registry/memory commands are documented in the bot [project-context skill](../bots/shared-skills/project-context/SKILL.md).
- Release launcher, configuration, and service commands are documented in [release setup](../RELEASE.md); their implementations live in `packaging/`.
