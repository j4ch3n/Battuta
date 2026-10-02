# Command usage

Run `battuta-project` from any directory after [installation](installation.md). Use `init` or `switch` to select a project before running `explain` or memory commands.

## Initialize a project

```sh
battuta-project init <github-repo-url>
```

Use `init` once to register a repository, clone it into `~/.battuta/projects/<repository-name>/code/`, create `project.yaml`, and select it as the current project. Authenticate with `gh auth login` first.

Accepted URL forms include:

```sh
battuta-project init https://github.com/team/atlas-api.git
battuta-project init git@github.com:team/atlas-api.git
battuta-project init ssh://git@github.com/team/atlas-api.git
```

Choose one form for the repository. The `.git` suffix is optional. Use a repository URL, not a branch or file URL; query strings and non-GitHub hosts are rejected.

The repository basename becomes the project name. Initialization never overwrites an existing folder, so repositories with the same basename collide. Use `switch` for an already registered project. A failed clone preserves the previous selection.

## Switch projects

```sh
battuta-project switch <project-name>
```

Use the exact folder name under `~/.battuta/projects/`, quoting names containing spaces:

```sh
battuta-project switch atlas-api
battuta-project switch 'My Project'
```

The command validates the project's configuration and checkout before updating the persisted selection. It does not change your shell's working directory. If the name is unknown or the configuration is invalid, the previous selection is preserved.

Selection is shared by bots and sessions using the same OS account. Reselect the intended project before commands if another session may have switched it.

## Inspect project context

```sh
battuta-project explain
```

Run `explain` after selecting a project and before working in its checkout. It takes no project argument; use `switch` first to inspect another project.

Use the documentation index to find and read applicable `README.md` and `AGENTS.md` files, then work from `~/.battuta/projects/<project>/code/`. Documentation paths are relative to that checkout. Discovery is recursive, while the directory tree is limited to two levels. Symlinks, dependencies, and generated directories are excluded.

## Read and edit project memory

All memory commands act on the current project and take no project argument. Retrieve memory before editing so you can retain relevant decisions and use the correct line indexes.

```sh
battuta-project memory get
battuta-project memory append 'Use PostgreSQL for durable application data.'
battuta-project memory replace 1 'Use PostgreSQL because imports require transactions.'
```

- `get`: read all memory entries with their 1-based indexes.
- `append <content>`: add one trimmed, non-empty line.
- `replace <line-index> <content>`: replace one existing line; indexes start at 1.
- `replaceAll <content>`: replace the entire memory with reconciled content, trimming each line and dropping blank lines.

Quote content as a single shell argument. `append` and `replace` reject multiline content. For whole-file reconciliation, pass the complete revised text without the displayed index prefixes:

```sh
battuta-project memory replaceAll 'Use PostgreSQL for durable application data.
Run API and migration tests before merging.'
```

To clear all memory:

```sh
battuta-project memory replaceAll ''
```

Run edits serially; concurrent edits are not merged automatically. Store durable decisions, rationale, and standing constraints rather than live ticket status or copies of repository instructions. See [memory editing and reconciliation](memory.md) for more guidance.

## Typical workflow

Register a new project and inspect its context:

```sh
battuta-project init https://github.com/team/atlas-api.git
battuta-project explain
battuta-project memory get
```

Register another repository when needed:

```sh
battuta-project init https://github.com/team/harbor-web.git
battuta-project explain
battuta-project memory get
```

Return to the first project before resuming work:

```sh
battuta-project switch atlas-api
battuta-project explain
battuta-project memory get
```

Read the relevant repository guidance and memory, work in the selected project's `code/` directory, and save lasting decisions with `memory append` or `memory replace`.

## Command help

Use `--help` at any command level to check arguments and available subcommands:

```sh
battuta-project --help
battuta-project init --help
battuta-project memory --help
battuta-project memory replace --help
```
