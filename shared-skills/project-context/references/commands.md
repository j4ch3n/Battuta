# Command usage

Run `battuta-project` from any directory after [installation](installation.md). Use `init` or `switch` to select a project before running `explain` or memory commands.

A bare `battuta-project` invocation displays command help.

## Initialize a project

```sh
battuta-project init <github-repo-url>
```

Use `init` once to register a repository, clone it into a managed checkout, and select it as the current project. Authenticate with `gh auth login` first. Use the checkout location printed by the command.

Accepted URL forms include:

```sh
battuta-project init https://github.com/team/atlas-api.git
battuta-project init git@github.com:team/atlas-api.git
battuta-project init ssh://git@github.com/team/atlas-api.git
```

Choose one form for the repository. The `.git` suffix is optional. Use a repository URL, not a branch or file URL; query strings and non-GitHub hosts are rejected.

The repository basename becomes the project name. Initialization never overwrites an existing folder, so repositories with the same basename collide. Use `switch` for an already registered project. A failed clone preserves the previous selection.

Optionally record existing Linear IDs during initialization:

```sh
battuta-project init https://github.com/team/atlas-api.git \
  --linear-project-id <project-id> --linear-team-id <team-id>
```

Both options are independently optional. Supplied IDs are trimmed and must not be blank. The command records these values locally without a Linear API request. GitHub cloning still uses the network.

## Switch projects

```sh
battuta-project switch <project-name>
```

Use the exact registered project name, quoting names containing spaces:

```sh
battuta-project switch atlas-api
battuta-project switch 'My Project'
```

The command validates the project's configuration and checkout before updating the persisted selection. It does not change your shell's working directory. If the name is unknown or the configuration is invalid, the previous selection is preserved.

Selection is shared by bots and sessions using the same OS account. Reselect the intended project before commands if another session may have switched it.

## Linear projects

### Link an existing Linear project

```sh
battuta-project linear link --project-id <project-id> --team-id <team-id>
```

Select a local project first. Both IDs are required, trimmed, and must not be blank. Linking replaces any previous Linear association while preserving the project's other settings. It records the supplied IDs locally without querying Linear or verifying that they exist remotely.

### Create and link a Linear project

```sh
battuta-project linear create 'Atlas Platform' --team-id <team-id>
```

Select the local project you want to link before creating. The name and explicit team ID are required. The command creates a new Linear project associated with the supplied team, then links it to the selected local project. Use this command only when a new remote project is needed; use `linear link` for an existing one.

If remote creation succeeds but saving the local link fails, the error includes the created project's ID, URL, and recovery commands. Fix the local error, select the original project, then run the supplied `linear link` command. This saves the link without creating another remote project. Creation is not automatically retried; if a request times out, inspect Linear before trying creation again.

`linear create` and `explain` for a linked project contact Linear. Linking and the initialization options record IDs for the selected project locally. Run state-changing commands serially to retain the intended selection and associations.

## Inspect project context

```sh
battuta-project explain
```

Run `explain` after selecting a project and before working in its checkout. It takes no project argument; use `switch` first to inspect another project.

The output includes the repository URL and the linked Linear project's URL. Repository information comes from the local registration; `not configured` means it is absent. For a linked project, the command fetches its actual URL from Linear and requires network access and a token with access to that project. An unlinked project shows `not linked` without contacting Linear. Lookup failures are reported as errors; the command does not change the project or its selection.

Use the documentation index to find and read applicable `README.md` and `AGENTS.md` files, then work from the displayed Project Root. Documentation paths are relative to that checkout. Discovery is recursive, while the directory tree is limited to two levels. Symlinks, dependencies, and generated directories are excluded.

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

Read the relevant repository guidance and memory, work in the checkout returned by `explain`, and save lasting decisions with `memory append` or `memory replace`.

## Command help

Use `--help` at any command level to check arguments and available subcommands:

```sh
battuta-project --help
battuta-project init --help
battuta-project linear --help
battuta-project linear create --help
battuta-project memory --help
battuta-project memory replace --help
```
