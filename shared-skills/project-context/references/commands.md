# Command contracts and examples

## Contracts

| Command   | Input                                                           | Result                                                                      |
| --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `init`    | GitHub HTTPS or SSH repository URL, optionally ending in `.git` | Clone to `<name>/code`, initialize YAML, and select the repository basename |
| `switch`  | Exact direct project-folder name                                | Validate registration and checkout, then update selection                   |
| `explain` | No arguments                                                    | Current checkout root, README/AGENTS index, and bounded ASCII tree          |

Accepted URL examples: `https://github.com/team/repo.git`, `git@github.com:team/repo.git`, and `ssh://git@github.com/team/repo.git`. Branch/file URLs, query strings, and non-GitHub hosts are rejected. Two repositories with the same basename collide; initialization never overwrites a folder.

Selection is persisted as:

```json
{ "currentProject": "atlas-api" }
```

Python uses Pydantic v2 models for persisted state, YAML configuration, and internal structured command data. PyYAML parses/emits YAML; Jinja presents validated model data. Newly initialized YAML has this shape (the path is an actual absolute path, not a literal `~`):

```yaml
version: 1
project:
  name: atlas-api
  path: /home/bot/.battuta/projects/atlas-api/code
linear:
  project_id: null
  team_id: null
github:
  repository: example-team/atlas-api
roles:
  engineer: Engineer
  reviewer: Reviewer
```

Missing selection instructs the user to initialize or switch. Invalid selection, configuration, checkout, or clone operations produce readable errors and nonzero exit status.

## Two-project walkthrough

These repositories and their contents are illustrative. `gh` may print its own clone progress before the tool's result.

### 1. Initialize Atlas API

```sh
battuta-project init https://github.com/example-team/atlas-api.git
```

```text
Initialized project: atlas-api
- Root: ~/.battuta/projects/atlas-api
- Code: ~/.battuta/projects/atlas-api/code
- Config: ~/.battuta/projects/atlas-api/project.yaml
- Current project: atlas-api

Next: battuta-project explain
```

### 2. Index Atlas API before work

```sh
battuta-project explain
```

```text
# Project: atlas-api

Project Root: ~/.battuta/projects/atlas-api/code

- README.md: README.md
- AGENTS.md: AGENTS.md
- Subfolder README.md files:
  - docs/README.md
  - src/api/README.md
- Subfolder AGENTS.md files:
  - src/AGENTS.md

Directory tree (maximum 2 directory levels):
code/
|-- AGENTS.md
|-- README.md
|-- docs/
|   `-- README.md
|-- pyproject.toml
|-- src/
|   |-- AGENTS.md
|   `-- api/
`-- tests/
    `-- test_health.py
```

Read applicable documents and work from the displayed Project Root. Document paths are relative to it. This command does not print configuration or memory locations.

### 3. Initialize and index Harbor Web

```sh
battuta-project init git@github.com:example-team/harbor-web.git
```

```text
Initialized project: harbor-web
- Root: ~/.battuta/projects/harbor-web
- Code: ~/.battuta/projects/harbor-web/code
- Config: ~/.battuta/projects/harbor-web/project.yaml
- Current project: harbor-web

Next: battuta-project explain
```

```sh
battuta-project explain
```

```text
# Project: harbor-web

Project Root: ~/.battuta/projects/harbor-web/code

- README.md: README.md
- AGENTS.md: not found
- Subfolder README.md files:
  - apps/site/README.md
- Subfolder AGENTS.md files:
  - apps/site/AGENTS.md

Directory tree (maximum 2 directory levels):
code/
|-- README.md
|-- apps/
|   `-- site/
|-- package.json
`-- packages/
    `-- ui/
```

### 4. Return to Atlas API

```sh
battuta-project switch atlas-api
```

```text
Current project: atlas-api
- Root: ~/.battuta/projects/atlas-api
- Code: ~/.battuta/projects/atlas-api/code
```

Switching to `harbor-web` produces the equivalent paths for Harbor. An unknown name fails without changing selection:

```text
Error: Project 'missing-project' was not found under /home/bot/.battuta/projects.
Available projects: atlas-api, harbor-web
```

## Discovery boundaries

README/AGENTS discovery is recursive and matches the exact filenames `README.md` and `AGENTS.md`. The tree shows two directory levels below `code/`, including files at the root and first directory level. Deeper documentation remains listed in the index. Missing root documents are `not found`; empty nested lists are `none found`. Ordering is lexical and deterministic.

Both discovery and tree output exclude symlinks and directories named `.git`, `.venv`, `venv`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.nuxt`, `.cache`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox`, or `__pycache__`.
