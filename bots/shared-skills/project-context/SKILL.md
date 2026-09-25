---
name: project-context
description: Manage registered project configuration and durable shared memory for PM and Tech Lead.
---

# Project context

Only PM and Tech Lead use the project registry and shared `MEMORY.md`. Executors must not load or read either; provide task-specific instructions and let them use their repository `AGENTS.md` and local runtime.

The CLI requires Python 3.12 or newer. Development dependencies are managed by `pyproject.toml` and `uv.lock`. Released archives vendor Click and PyYAML, but do not bundle Python; use a `python3` executable at version 3.12+ there. No package installation is needed at release runtime.

From a source checkout at the repository root, run the CLI in the project's locked uv environment:

```sh
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py show <name> [checkout-path]
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py read <name>
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py write <name> 'Durable context'
```

Supply multiline text in a literal quoted argument.

From a PM or Tech Lead workspace in a source checkout (`bots/pm-bot` or `bots/tech-lead-bot`), return to the repository root first:

```sh
cd ../..
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py show <name> [checkout-path]
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py read <name>
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py write <name> 'Durable context'
```

From the root of a released archive, use Python 3.12+ and the vendored dependencies:

```sh
python3 bots/shared-skills/project-context/scripts/project_context.py show <name> [checkout-path]
python3 bots/shared-skills/project-context/scripts/project_context.py read <name>
python3 bots/shared-skills/project-context/scripts/project_context.py write <name> 'Durable context'
```

Memory is not an automatic prompt injection or a snapshot of issue trackers/repository state. Keep only durable decisions and context; never store ticket handles or generated/repository instructions.

## Filesystem handling

The registry rejects project, config, and memory paths that statically resolve through symlinks outside their expected locations. These checks are not race-free against a same-UID process that can alter paths concurrently. Project config and `MEMORY.md` files are created with mode `0600` for ordinary local-user isolation; this does not restrict the owning UID. These checks and permissions are not an authentication or security boundary.
