# Battuta contributor guidance

## Objective

Build a collaborative AI team that takes software projects from product conversations through technical planning, implementation, and verified review. The Project Manager and Tech Lead are active; engineer and review bots are work in progress.

## Stack

TypeScript on Node.js and Deno, the Pi coding-agent runtime, Telegram, Linear, and Supabase (PostgreSQL, Edge Functions, Realtime). Python supports configuration and project-context tooling. See [stack details](docs/tech-stack.md) for versions and tooling.

## Working conventions

- Name new ticket branches `agent/<ticket>-<short-description>`, using a lowercase ticket identifier and fewer than four hyphen-separated description words (for example, `agent/fis-46-constitution-tool`).
- Follow surrounding code and runtime-specific formatting, linting, and typing rules.
- Scan related code before adding logic; reuse existing helpers and refactor duplication within the affected scope. Avoid unrelated rewrites.
- Cover changed behavior, edge cases, and regressions with meaningful tests. Use parameterized tests for equivalent cases.
- Keep unit tests small and focused. Stub external services, clocks, and runtime boundaries; exercise real internal logic. Use integration tests for cross-system behavior.
- For `scripts/`, organize tests in `scripts/tests/test_<script_or_module>.py` by the script or helper they exercise. Keep configuration/parsing tests separate from launcher orchestration; avoid a single catch-all launch test suite. Run discovery through `pnpm check:support`.
- For shared skills, keep instructions and references under `shared-skills/<skill>/` and tool code, package metadata, dependencies, and tests under `shared-skills/<skill>-cli/`. `pnpm check:support` discovers each CLI's `tests/` directory in its own locked Python environment.
- Write skills and command references around when and how to use the tool, with concise usage examples and descriptions of user-visible effects. Command references should explain invocation, workflow, and impact rather than serve as code documentation; keep environment prerequisites in installation guidance and schemas, output examples, and implementation details in dedicated technical references when needed.
- Keep skill declarations, discovery triggers, and usage guidance in the owning `SKILL.md`; do not repeat them in bot instruction sources. Bot instructions define enduring responsibilities and authority rather than duplicate the skill catalog.
- In skill instructions and prompts, link only to prompts, templates, and references owned by that skill. Refer to other skills by skill name (for example, use the `memory` skill), not by file paths or links to their `SKILL.md` or supporting files.
- Review coverage for changed modules and address meaningful gaps; do not optimize for a percentage alone. Run relevant verification before claiming completion.
- Keep every `README.md` concise: project/component description, high-level features, and links to getting started and further guidance. Put commands, setup, stack details, and technical explanations in focused references.
- Keep this file high-level and link to a single maintained source rather than duplicating technical guidance.

## Project structure

Paths below are relative to the repository root.

`.agents/skills/` contains contributor/development-agent workflows for working on Battuta itself; it is not the day-to-day Pi bot skill environment. Runtime skills must be exposed under each bot's `bots/<bot>/.pi/skills/`. Shared runtime content lives in `shared-skills/` and is linked there by bot setup; the responsibility-based document collections are part of each bot's `project-context` skill. See [runtime document responsibilities](shared-skills/project-context/SKILL.md#document-responsibilities).

| Path                                                                | Purpose                                                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-mail/index.ts`                                               | Pi messaging extension; `content.ts` defines the content contract and `schemas.ts` validates tools                                                                                     |
| `agent-mail/tests/`, `agent-mail/vitest.config.ts`                  | Node unit/integration tests and coverage configuration                                                                                                                                 |
| `project-spec/`                                                     | Shared role-specific Pi tools for versioned documents, canonical checklist/review, and terminal decisions; see [tool workflow](shared-skills/project-context/references/spec-tools.md) |
| `memory-stone/`                                                     | Shared PM/TL memory bridge, selected-project binding, Stone utilities, and tests; see [memory runtime](docs/memory-stone.md)                                                           |
| `supabase/functions/agent-mail/`                                    | Mail backend; Deno tests and tasks live with the function                                                                                                                              |
| `supabase/functions/linear-webhook/`                                | Linear webhook integration and co-located Deno tests                                                                                                                                   |
| `supabase/migrations/`, `supabase/tests/`                           | Database schema and permissions tests                                                                                                                                                  |
| `bots/AGENTS_shared.md`, `bots/{pm-bot,tl-bot}/AGENTS_dedicated.md` | Shared and role-specific bot instruction sources                                                                                                                                       |
| `bots/{pm-bot,tl-bot}/scripts/configure-bot.py`                     | Bot setup and runtime configuration                                                                                                                                                    |
| `bots/pm-bot/scripts/run-dev.sh`                                    | Shared dev/prod tmux launcher                                                                                                                                                          |
| `bots/pm-bot/.pi/extensions/pm-bot/index.ts`                        | PM runtime extension                                                                                                                                                                   |
| `bots/{pm-bot,tl-bot}/.pi/skills/`                                  | Day-to-day Pi runtime skills, including the shared project-context link                                                                                                                |
| `shared-skills/project-context/`                                    | Project-context skill instructions and references                                                                                                                                      |
| `shared-skills/project-context-cli/`                                | Project registry and memory CLI package, dependencies, and tests                                                                                                                       |
| `scripts/`, root `package.json`, `Makefile`                         | Development checks, commands, and runtime-specific tooling                                                                                                                             |
| `packaging/`, `.github/workflows/release.yml`                       | Release launcher, configuration, services, and assembly                                                                                                                                |
| `docs/`                                                             | Shared technical references and detailed material without a dedicated workflow home                                                                                                    |

Bot `AGENTS.md` files are generated runtime instructions; edit their shared/dedicated sources for lasting changes. Private environment files and bot auth/session state are local configuration, not documentation sources. See [agent mail architecture](docs/agent-mail.md) for messaging behavior.

See [installing Pi extensions](docs/pi-extensions.md) for bot-local package installation, dependency checks, release wiring, and verification.
