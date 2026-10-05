# Command usage

Run `battuta-project` from any directory after [installation](installation.md). The CLI owns project discovery and workspace management; [project-spec tools](spec-tools.md) own spec discovery and lifecycle. Use `list` to discover projects, then `init` or `switch` to select one before running `current` or `explain`. [Memory tools](../../memory/SKILL.md) use the request-bound selection. Obtain locations from command/tool results rather than assuming storage layout.

A bare `battuta-project` invocation displays command help.

## Initialize a project

```sh
battuta-project init <github-repo-url>
```

Use `init` once to register a repository, clone it into a managed checkout, render a summary skeleton, and select it as the current project. Authenticate with `gh auth login` first. Use the locations printed by the command. Fill the overview from confirmed conversation and repository evidence during project discovery.

The summary has Purpose, Users and use cases, Scope, Current capabilities, and Specifications sections with explicit unknowns. Initialization does not establish spec storage or a constitution. Managed documents are created by spec tools only when requested.

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

## List registered projects

```sh
battuta-project list
```

The command returns a numbered Markdown list sorted by project name. Each entry has a bold name followed by indented `Project Root` and `Code` lines: the managed project directory and repository checkout, respectively. Paths under the home directory are abbreviated with `~`; other paths remain absolute.

Listing validates registrations and checkouts but does not require or change current selection, read spec inventories, or contact Linear. Hidden directories, symlinks, and non-directory entries are excluded. An empty or absent registry reports `No registered projects.` without creating it. An invalid registration reports an error.

## Read the current selection

```sh
battuta-project current
```

The response is a single line, for example `Current Project: atlas-api`. It reads the persisted name only, without loading project configuration, scanning a checkout, inspecting specs, or contacting Linear. Missing selection reports an error directing you to `init` or `switch`. It does not change state.

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

Run `explain` after selecting a project and before working in its checkout or writing project artifacts. It takes no project argument; use `switch` first to inspect another project.

The output distinguishes the Managed Project Directory from Project Root (the repository checkout) and reports the Summary path. Unlike `list`, `explain` labels the checkout as `Project Root`. Spec and constitution discovery belong to spec tools and are not included as overview fields.

The Project Summary section displays the managed `SUMMARY.md` as Markdown. Missing or blank summaries show `Project summary: not written yet`; unreadable, invalid UTF-8, symlink, or non-file summaries produce a file error. `explain` never edits the summary or creates artifact directories. Older registrations without a summary remain valid.

The output includes the repository URL and the linked Linear project's URL. Repository information comes from the local registration; `not configured` means it is absent. For a linked project, the command fetches its actual URL from Linear and requires network access and a token with access to that project. An unlinked project shows `not linked` without contacting Linear. Lookup failures are reported as errors; the command does not change the project or its selection.

Use the documentation index to find and read applicable `README.md` and `AGENTS.md` files, then work from the displayed Project Root. Documentation paths are relative to that checkout. Discovery is recursive, while the directory tree is limited to two levels. Symlinks, dependencies, and generated directories are excluded.

## Write project documents

Use the [responsibility entries and Workspace binding](../SKILL.md#document-responsibilities) to shape documents. Use [project-spec agent tools](spec-tools.md) for managed specifications, technical plans, tasks, canonical checklists/reviews, and decisions. PM writes full immutable versions; TL writes full checklist/review replacements. The CLI does not author specs or record decisions. The project summary can use ordinary file tools at its reported location.

Maintain the overview at the reported Summary path. Inspect the named project's inventory with `inspect_specs` and resolve versions/artifacts through `describe_spec`; no saved version is patched. Existing unregistered documents are preserved. Memory is durable operational context, not the product-decision or specification source of truth.

Older registrations may lack some scaffold files. Reinstallation does not migrate them, and `explain` does not write them. Requested authoring establishes missing artifacts and parent directories while preserving existing content; do not rerun `init` against an existing project.

## Record product decisions

PM uses `finalize_spec` with explicit project/name, go/no-go, and full rationale. The shared agent tool creates `decision.md`, fingerprints the latest spec/checklist/decision/review, and records the terminal outcome in JSON. Read [decision workflow and effects](decisions.md); no review/checklist gate or standalone announcement mail is required. Refinement creates a new version before finalization.

## Recall project and global memory

Use the [memory skill](../../memory/SKILL.md) for scoped Pi tools. Project memory binds to selection at request start; a switch applies on the next request. Retrieve stable decisions and rationale, confirm live facts against current evidence, and store only explicitly requested durable content. Global preferences/identity require explicit cross-project storage intent.

## Typical workflow

Register a new project and inspect its context:

```sh
battuta-project init https://github.com/team/atlas-api.git
battuta-project explain
```

Register another repository when needed:

```sh
battuta-project init https://github.com/team/harbor-web.git
battuta-project explain
```

Return to the first project before resuming work:

```sh
battuta-project switch atlas-api
battuta-project current
battuta-project explain
```

Read the relevant repository guidance and scoped memory, work in the checkout returned by `explain`, and use the memory tools for requested lasting decisions. If this request switched projects, continue memory work on the next request under the new binding.

## Command help

Use `--help` at any command level to check arguments and available subcommands:

```sh
battuta-project --help
battuta-project list --help
battuta-project current --help
battuta-project init --help
battuta-project linear --help
battuta-project linear create --help
```
