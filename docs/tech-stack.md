# Tech stack

Shared memory uses an isolated Python 3.12 MCP service with pinned mcp-memory-service 12.1.1, SQLite/sqlite-vec and local ONNX MiniLM CPU embeddings. A TypeScript Pi adapter owns project-catalog discovery/validation, conversation capture, CoS-only profile loading and local 05:30 dream consolidation through CoS's model. The server accepts opaque lowercase-normalized project names without registry dependencies. See [memory architecture](memory-service.md).

## Main application and support tooling

| Layer                      | Technology and responsibility                                                                  | Version source                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Agents                     | Ordinary Pi CLI instances; CoS, Manager, and worker-owned assignment extension                 | Bot manifests; worker `bots/worker/extension/assignment-worker/package.json` and lockfile |
| Node                       | TypeScript extensions, Telegram integration, agent-mail client                                 | `.node-version`, `.nvmrc`, root and package `package.json`                                |
| Backend                    | Supabase PostgreSQL, migrations, Edge Functions, and Realtime                                  | `.supabase-version`, `supabase/config.toml`                                               |
| Edge Functions             | Deno TypeScript for agent mail and Linear webhooks                                             | `.deno-version`, each function's `deno.json` and lockfile                                 |
| Conversations and tracking | Telegram bots, Linear, MCP integrations                                                        | Bot configuration scripts and runtime configuration                                       |
| Bot configuration          | Python 3.12+, Click, Pydantic, uv                                                              | `scripts/bot_setup/pyproject.toml`, `scripts/bot_setup/uv.lock`                           |
| Artifact catalog           | Python 3.12+, FastAPI/Starlette, SQLite/aiosqlite, Alembic, Click, Jinja2, markdown-it-py, SSE | `artifact-service/pyproject.toml`, `artifact-service/uv.lock`                             |
| Dependency tooling         | pnpm for Node; uv for Python                                                                   | Root `package.json`; each Python project's `pyproject.toml` and `uv.lock`                 |
| Verification               | Prettier, typed ESLint, TypeScript, Vitest/V8 coverage, Deno tests, pgTAP                      | Root and component manifests, check scripts                                               |
| Launch and releases        | tmux; Linux ARM64 archive with bundled Node/dependencies; optional user systemd services       | `Makefile`, `scripts/packaging/`, release workflow                                        |

## Individual shared skills

Runtime instructions and complete owned resources live in `skills-hub/<skill>/`, selected by profile manifests. See [skill management](skill-management.md) for naming, validation, and distribution. The executable project CLI lives in `project-context-cli/`, including tool source, bundled CLI templates, package metadata, dependencies, lockfile, and tests. CLI packages are not dependencies of the main application's root Python project.

| Skill                                                           | Technology and responsibility                                                | Version source                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Project management](../skills-hub/project-management/SKILL.md) | Python 3.12+, Click, Pydantic v2, PyYAML, Jinja2, uv; GitHub CLI for cloning | `project-context-cli/pyproject.toml`, `project-context-cli/uv.lock` |

Project CLI tests live under `project-context-cli/tests/`. `pnpm check:support` runs the suite using the package's own locked Python environment.

## Dependency ownership and verification

Version files and manifests are authoritative; use their current values rather than an independently maintained version list. Node packages, Edge Functions, and individual skills have separate lockfiles. Supabase integration checks require Docker.

Prettier formats repository-owned TypeScript/JavaScript, JSON, YAML, and Markdown across both runtimes. Typed ESLint handles Node code; Deno handles Edge Function linting and type checks. Follow the existing two-space indentation, double quotes, semicolons, and LF line endings. Deno editor support is scoped to `supabase/functions`; do not use `deno fmt` for Prettier-owned files.

See [development](../.agents/skills/battuta-setup/references/development.md) for source setup, [code checks](../.agents/skills/battuta-verify/references/checks.md) for verification, [commands](commands.md) for tooling entry points, and [release setup](../RELEASE.md) for the prebuilt distribution.
