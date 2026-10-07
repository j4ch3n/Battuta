# Tech stack

## Main application and support tooling

| Layer                      | Technology and responsibility                                                            | Version source                                             |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Agents                     | Pi coding-agent runtime; active PM and TL bots                                           | Each bot's `package.json` and lockfile                     |
| Node                       | TypeScript extensions, Telegram integration, agent-mail client                           | `.node-version`, `.nvmrc`, root and package `package.json` |
| Backend                    | Supabase PostgreSQL, migrations, Edge Functions, and Realtime                            | `.supabase-version`, `supabase/config.toml`                |
| Edge Functions             | Deno TypeScript for agent mail and Linear webhooks                                       | `.deno-version`, each function's `deno.json` and lockfile  |
| Conversations and tracking | Telegram bots, Linear, MCP integrations                                                  | Bot configuration scripts and runtime configuration        |
| Bot configuration          | Python 3.12+, Click, uv                                                                  | Root `pyproject.toml`, `uv.lock`                           |
| Dependency tooling         | pnpm for Node; uv for Python                                                             | Root `packageManager`, `uv.lock`                           |
| Verification               | Prettier, typed ESLint, TypeScript, Vitest/V8 coverage, Deno tests, pgTAP                | Root and component manifests, check scripts                |
| Launch and releases        | tmux; Linux ARM64 archive with bundled Node/dependencies; optional user systemd services | `Makefile`, `packaging/`, release workflow                 |

## Individual shared skills

Each skill keeps its instructions and references in `shared-skills/<skill>/`. Its sibling `shared-skills/<skill>-cli/` contains the tool source, bundled templates, package metadata, dependencies, lockfile, and tests. CLI packages are not dependencies of the main application's root Python project.

| Skill                                                        | Technology and responsibility                                                | Version source                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Project context](../shared-skills/project-context/SKILL.md) | Python 3.12+, Click, Pydantic v2, PyYAML, Jinja2, uv; GitHub CLI for cloning | `shared-skills/project-context-cli/pyproject.toml`, `shared-skills/project-context-cli/uv.lock` |

CLI tests live under `shared-skills/<skill>-cli/tests/`. `pnpm check:support` runs each suite using that CLI package's own locked Python environment.

## Dependency ownership and verification

Version files and manifests are authoritative; use their current values rather than an independently maintained version list. Node packages, Edge Functions, and individual skills have separate lockfiles. Supabase integration checks require Docker.

Prettier formats repository-owned TypeScript/JavaScript, JSON, YAML, and Markdown across both runtimes. Typed ESLint handles Node code; Deno handles Edge Function linting and type checks. Follow the existing two-space indentation, double quotes, semicolons, and LF line endings. Deno editor support is scoped to `supabase/functions`; do not use `deno fmt` for Prettier-owned files.

See [development](../.agents/skills/battuta-setup/references/development.md) for source setup, [code checks](../.agents/skills/battuta-verify/references/checks.md) for verification, [commands](commands.md) for tooling entry points, and [release setup](../RELEASE.md) for the prebuilt distribution.

## Task execution boundary

Task delegation and the Node 24 worker use dedicated Supabase Auth machine identities and the task-pool Edge API. Worker sessions use pinned `@opencode/client` **2.0.24** against an already-running OpenCode V2 **2.0.24** service; discovery and native authentication are reused, with no daemon service lifecycle authority. [Worker operation](task-delegation.md) describes single-row persistence, native sessions and verification limits.
