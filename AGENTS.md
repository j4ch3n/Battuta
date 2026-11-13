# Battuta contributor guidance

## Objective

Build a collaborative AI team that takes software projects from product conversations through technical planning, implementation, and verified review. The Project Manager and Tech Lead are active; engineer and review bots are work in progress.

## Stack

TypeScript on Node.js and Deno, the Pi coding-agent runtime, Telegram, Linear, and Supabase (PostgreSQL, Edge Functions, Realtime). Python supports configuration and project-context tooling. See [stack details](docs/tech-stack.md) for versions and tooling.

## Working conventions

- Store implementation plans under `docs/superpowers/plans/` and design/specification documents under `docs/superpowers/spec/`.
- Name new ticket branches `agent/<ticket>-<short-description>`, using a lowercase ticket identifier and fewer than four hyphen-separated description words (for example, `agent/fis-46-constitution-tool`).
- Follow surrounding code and runtime-specific formatting, linting, and typing rules.
- Scan related code before adding logic; reuse existing helpers and refactor duplication within the affected scope. Avoid unrelated rewrites.
- Put non-runtime tooling—setup, configuration, packaging, and test-environment/check orchestration—under responsibility-based subdirectories of `scripts/`, not the repository root or bot runtime directories. Python tooling projects own their `pyproject.toml`, `uv.lock`, local `.gitignore`, environment, and tests; reuse shared package logic rather than duplicate it. See [development commands](docs/commands.md) for entry points.
- Cover changed behavior, edge cases, and regressions with meaningful tests. Use parameterized tests for equivalent cases.
- Arrange tests using the current post-update state as the starting state; do not add legacy-state or migration scenarios unless migration behavior is explicitly in scope.
- For setup/configuration tests, test behavior (validation, role separation, preservation, idempotence, failure handling, and credential privacy), not exact configured values or configuration snapshots.
- Keep setup/release testing minimal: reuse existing test infrastructure, add only focused checks for changed executable behavior, and do not introduce extra test setup, elaborate fixtures, or duplicate end-to-end launch tests. Leave authentication and bot/model functional checks to the human.
- Do not add tests that assert prompt or instruction wording. Test executable behavior and integration contracts instead.
- Keep unit tests small and focused. Stub external services, clocks, and runtime boundaries; exercise real internal logic. Use integration tests for cross-system behavior.
- Keep package unit tests independent of sibling packages: use package-local, contract-faithful mocks instead of importing sibling implementations or test fixtures, or installing sibling dependencies solely for tests. Verify real cross-package wiring in explicit integration tests.
- Name Python integration tests `<subject>.it.py`; keep unit tests as `test_<subject>.py`. Run both through `pnpm check:support`; see [code checks](.agents/skills/battuta-verify/references/checks.md) for direct invocation and opt-in integration prerequisites.
- Keep setup and packaging tests in their owning `scripts/bot_setup/tests/` and `scripts/packaging/tests/` projects. Use their separate locked uv environments and `/tmp` test workspaces, not the checkout. Keep configuration/parsing tests separate from launcher orchestration; run all support suites through `pnpm check:support`.
- Keep complete runtime skill sources and owned resources under `skills-hub/<name>/`; per-profile `skills.json` manifests select local discovery links generated during source configuration. Never commit `.pi/skills/`, `.pi/mail-sessions/`, or `.pi/sessions/` runtime output. Releases build complete per-role skill bundles without shipping the source catalog. Match lowercase kebab-case catalog, manifest, and frontmatter names. See [skill management](docs/skill-management.md) for the maintained naming, manifest, lifecycle, and validation contract.
- Keep contributor skills and executable CLI packages outside the runtime hub. The project CLI lives at `project-context-cli/`; `pnpm check:support` runs its tests in its locked Python environment. Preserve custom skill content and private runtime state when configuring bots or staging releases.
- Keep skills and their command references focused on usage: when and how to invoke tools, workflows, concise examples, user-visible effects, and recovery actions. Describe setup and development workflows by their purpose and observable behavior, not coding details or per-file copy lists. Put implementation details—storage layout, persistence schemas, locking, and configuration mechanics—in the owning technical reference under `docs/`; link to it rather than repeating those details in workflow summaries. Keep environment prerequisites in installation guidance.
- Keep focused runtime skills self-contained in `SKILL.md`, including their commands. Use owning references for larger command surfaces, with one maintained command contract rather than duplicated guidance. Installation guides are linked only from [release setup](RELEASE.md), which indexes setup for every extension and skill; runtime skills and command references do not carry installation navigation.
- When write the validation steps in setup documents, make filesystem/command-line checks only, expected observable results, and make the setup fail fast if not able to proceed, not need to recover the failure. Do not message CoS/Manager or any other bot, invoke models, or make LLM requests for setup checks. Keep these separate from developer verification history, benchmarks, and product acceptance; never print secrets or mutate production just to test.
- Keep skill declarations, discovery triggers, and usage guidance in the owning `SKILL.md`; do not repeat them in bot instruction sources. Bot instructions define enduring responsibilities and authority rather than duplicate the skill catalog.
- In skill instructions and prompts, link only to prompts, templates, and references owned by that skill. Refer to other skills by skill name (for example, use the `memory` skill), not by file paths or links to their `SKILL.md` or supporting files.
- Avoid repeating attribution in runtime instructions. When reusing MIT or other suitably licensed material, retain the notices required by that source's license in an accompanying license or notices file.
- Review coverage for changed modules and address meaningful gaps; do not optimize for a percentage alone. Run relevant verification before claiming completion.
- Keep every `README.md` concise: project/component description, high-level features, and links to getting started and further guidance. Put commands, setup, stack details, and technical explanations in focused references.
- Keep this file high-level and link to a single maintained source rather than duplicating technical guidance.

## Project structure

See [the project index and Serena guidance](docs/serena.md) for repository paths, indexing, and efficient code navigation. Maintain the directory index there rather than duplicating it here.

Bot `AGENTS.md` files are generated runtime instructions; edit their shared/dedicated sources for lasting changes. Private environment files and bot auth/session state are local configuration, not documentation sources. See [agent mail architecture](docs/agent-mail.md) for messaging behavior.

Use the [extension and skill setup index](RELEASE.md#extension-and-skill-setup-index) to find installation guidance for bundled components and additional Pi packages.
