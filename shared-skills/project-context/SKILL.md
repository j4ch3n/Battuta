---
name: project-context
description: Use when working on, researching, coding, or building artifacts for a project.
---

# Project context

## Overview

`battuta-project` manages project checkouts, indexes repository guidance, and stores durable project memory shared by the bots. Before project work, select the intended project, run `explain`, and read the relevant README/AGENTS files. Run commands from any directory after [installation](references/installation.md).

Run `linear refresh` explicitly to discover current teams. `linear refresh`, `linear create`, and `explain` for a linked project contact Linear; GitHub initialization still clones over the network.

## Commands

### `battuta-project init <github-repo-url>`

**Usage:** `battuta-project init https://github.com/team/atlas-api.git`

**Output:** Project root, checkout location, and current selection.

**Process:** Clone with `gh` into a managed checkout and select the project. Already registered names cause an error; failed cloning preserves the previous selection.

**Linear metadata:** Optional `--linear-project-id <id>` and `--linear-team-id <id>` record existing IDs without querying Linear. Each omitted field defaults to `null`.

### `battuta-project switch <project-name>`

**Usage:** `battuta-project switch atlas-api`

**Output:** Current project and checkout location.

**Process:** Select a registered project by its exact name after validating its checkout. A missing project causes an error. This does not change the shell directory.

### `battuta-project explain`

**Usage:** `battuta-project explain`

**Output:** Project Root (the checkout), repository URL, Linear project URL, relative README/AGENTS locations, and a two-level ASCII directory tree.

**Process:** Use the current project; discover nested documentation recursively while excluding dependencies, generated directories, and symlinks. Fetch the linked project's URL from Linear; an unlinked project shows `not linked` without a request. Lookup failures cause an error. Read the applicable instructions before working in the displayed Project Root.

### `battuta-project linear <operation>`

| Operation | Usage                                                           | Behavior                                                                                                                          |
| --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `refresh` | `battuta-project linear refresh`                                | Fetch all accessible, non-archived teams; print and cache names/IDs. No current project required.                                 |
| `link`    | `battuta-project linear link --project-id <id> --team-id <id>`  | Associate both IDs with the current project; no Linear request.                                                                   |
| `create`  | `battuta-project linear create 'Atlas Platform' --team-id <id>` | Create a Linear project, print its ID/URL, and link it to the current local project. Explicit team required; refresh is optional. |

IDs and creation names must not be blank. Refresh preserves selection and other config fields; `init`/`switch` preserve cached teams. If creation succeeds but local saving fails, fix the local error and use the error's `switch`/`linear link` recovery commands rather than creating a duplicate. After a creation timeout, inspect Linear before retrying. See [command contracts](references/commands.md#linear-projects-and-teams).

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

Initialize `atlas-api`, run `explain`, and work in the displayed Project Root. Initialize `harbor-web` to select it, then use `switch atlas-api` to return. Before each project's work, confirm selection with `explain` and retrieve relevant memory. Selection is shared by bots using the same OS account; reselect the intended project before commands if another session may have switched it.

## Reference files

- [Installation and migration](references/installation.md)
- [Command contracts and two-project examples](references/commands.md)
- [Memory editing and reconciliation](references/memory.md)
