# Battuta contributor guidance

## Objective

Build a collaborative AI team that takes software projects from product conversations through technical planning, implementation, and verified review. The Project Manager and Tech Lead are active; engineer and review bots are work in progress.

## Stack

TypeScript on Node.js and Deno, the Pi coding-agent runtime, Telegram, Linear, and Supabase (PostgreSQL, Edge Functions, Realtime). Python supports configuration and project-context tooling. See [stack details](docs/tech-stack.md) for versions and tooling.

## Working conventions

- Follow surrounding code and runtime-specific formatting, linting, and typing rules.
- Scan related code before adding logic; reuse existing helpers and refactor duplication within the affected scope. Avoid unrelated rewrites.
- Cover changed behavior, edge cases, and regressions with meaningful tests. Use parameterized tests for equivalent cases.
- Keep unit tests small and focused. Stub external services, clocks, and runtime boundaries; exercise real internal logic. Use integration tests for cross-system behavior.
- Review coverage for changed modules and address meaningful gaps; do not optimize for a percentage alone. Run relevant verification before claiming completion.
- Keep every `README.md` concise: project/component description, high-level features, and links to getting started and further guidance. Put commands, setup, stack details, and technical explanations in focused references.
- Keep this file high-level and link to a single maintained source rather than duplicating technical guidance.

## Project structure

Paths below are relative to the repository root.

| Path                                                                | Purpose                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `agent-mail/index.ts`                                               | Pi messaging extension; `content.ts` defines the content contract and `schemas.ts` validates tools |
| `agent-mail/tests/`, `agent-mail/vitest.config.ts`                  | Node unit/integration tests and coverage configuration                                             |
| `supabase/functions/agent-mail/`                                    | Mail backend; Deno tests and tasks live with the function                                          |
| `supabase/functions/linear-webhook/`                                | Linear webhook integration and co-located Deno tests                                               |
| `supabase/migrations/`, `supabase/tests/`                           | Database schema and permissions tests                                                              |
| `bots/AGENTS_shared.md`, `bots/{pm-bot,tl-bot}/AGENTS_dedicated.md` | Shared and role-specific bot instruction sources                                                   |
| `bots/{pm-bot,tl-bot}/scripts/configure-bot.py`                     | Bot setup and runtime configuration                                                                |
| `bots/pm-bot/scripts/run-dev.sh`                                    | Shared dev/prod tmux launcher                                                                      |
| `bots/pm-bot/.pi/extensions/pm-bot/index.ts`                        | PM runtime extension                                                                               |
| `bots/shared-skills/project-context/`                               | Shared project registry and memory tooling                                                         |
| `scripts/`, root `package.json`, `Makefile`                         | Development checks, commands, and runtime-specific tooling                                         |
| `packaging/`, `.github/workflows/release.yml`                       | Release launcher, configuration, services, and assembly                                            |
| `docs/`                                                             | Shared technical references and detailed material without a dedicated workflow home                |

Bot `AGENTS.md` files are generated runtime instructions; edit their shared/dedicated sources for lasting changes. Private environment files and bot auth/session state are local configuration, not documentation sources. See [agent mail architecture](docs/agent-mail.md) for messaging behavior.
