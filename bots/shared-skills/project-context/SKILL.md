---
name: project-context
description: Use when the PM or Tech Lead starts work on a registered project, needs its checkout or role configuration, or needs to recall or save durable project decisions across sessions.
---

# Project context

The project registry stores each project's configuration; `MEMORY.md` stores durable context shared by the PM and Tech Lead. Neither is loaded automatically. Use this skill to retrieve the context relevant to the current project and update it when a lasting decision changes.

## When to load context

- At the start of project-specific work, identify the project name and run `show` to obtain its registered checkout, integrations, and roles. If the project has not been registered, initialize it by supplying its checkout path to `show` once.
- Run `read` when prior decisions or standing constraints could affect the work, especially before making a decision that may conflict with earlier context. An empty result means there is no saved memory yet.
- Check current repository and issue-tracker evidence for live facts. Memory is for durable decisions and rationale, not current ticket status or a snapshot of the codebase.

## When to update memory

Save decisions, their rationale, and stable project constraints that the PM and Tech Lead will need in future sessions. A brief ticket identifier is optional when it helps trace a decision; do not store ticket URLs, transient progress, or generated or repository instructions. For example:

- “Use the existing worker for imports because the deployment has no separate queue (decided during IMP-42).”
- “Retrying an import must retain the original import record so users can trace its history.”

Check the issue tracker for whether a ticket is complete; memory is not its status record. Before writing, read the existing memory and retain anything still relevant: **`write` replaces the entire `MEMORY.md`**.

## Run the script

From a source checkout's repository root, use the locked Python environment:

```sh
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py show my-project
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py show my-project /absolute/path/to/checkout
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py read my-project
uv run --locked python bots/shared-skills/project-context/scripts/project_context.py write my-project 'Durable context'
```

Use the second command only to initialize a missing project; a checkout path is rejected for an existing registration. Supply multiline memory as one quoted argument. From the root of a released archive, use the same script path with `python3` instead of `uv run --locked python`. The CLI requires Python 3.12+; the release archive vendors its library dependencies but not Python.
