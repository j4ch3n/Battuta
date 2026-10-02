---
name: project-context
description: Use when working on, researching, coding, or building artifacts for a project.
---

# Project context

## Overview

`battuta-project` manages project checkouts, indexes repository guidance, and stores durable project memory shared by the bots. Before project work, select the intended project, run `explain`, and read the relevant README/AGENTS files. Run commands from any directory after [installation](references/installation.md).

## Commands

### `battuta-project init <github-repo-url>`

**Usage:** `battuta-project init https://github.com/team/atlas-api.git`

**Output:** Project root, checkout, configuration, and current selection.

**Process:** Clone with `gh` into `~/.battuta/projects/<repository-name>/code`, create project configuration, and select the project. Existing folders cause an error; failed cloning preserves the previous selection.

### `battuta-project switch <project-name>`

**Usage:** `battuta-project switch atlas-api`

**Output:** Current project and checkout location.

**Process:** Match an exact folder name under `~/.battuta/projects/`, validate its configuration and checkout, and persist `currentProject`. A missing project causes an error. This does not change the shell directory.

### `battuta-project explain`

**Usage:** `battuta-project explain`

**Output:** Project Root (the `code/` checkout), relative README/AGENTS locations, and a two-level ASCII directory tree.

**Process:** Use the current project; discover nested documentation recursively while excluding dependencies, generated directories, and symlinks. Read the applicable instructions before working in the displayed Project Root.

### `battuta-project memory <operation>`

**Usage:**

```sh
battuta-project memory get
battuta-project memory append 'Use the existing worker for imports.'
battuta-project memory replace 1 'Use the existing worker because deployment has no queue.'
battuta-project memory replaceAll 'Complete reconciled memory'
```

**Output:** `get` returns full memory with 1-based indexes; edits confirm the changed line or entry count.

**Process:** Use the current project. Append/replace one trimmed, non-empty line; `replaceAll` trims each line and drops blanks. Retrieve memory before editing; reconcile using unnumbered content. Save durable decisions and rationale, not live ticket status or repository instructions. See [memory guidance](references/memory.md).

## Workflow example

Initialize `atlas-api`, run `explain`, and work in its checkout. Initialize `harbor-web` to select it, then use `switch atlas-api` to return. Before each project's work, confirm selection with `explain` and retrieve relevant memory. Selection is shared by bots using the same OS account; reselect the intended project before commands if another session may have switched it.

## File locations

- Checkouts: `~/.battuta/projects/<project>/code/`
- Project configuration and memory: `~/.battuta/projects/<project>/{project.yaml,MEMORY.md}`
- Selection: `~/.battuta/projects/.config.json`

## Reference files

- [Installation and migration](references/installation.md)
- [Command contracts and two-project examples](references/commands.md)
- [Memory editing and reconciliation](references/memory.md)
