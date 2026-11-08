# Command usage

Run `battuta-project` from any directory. The CLI owns project discovery and workspace management; [project-spec tools](spec-tools.md) own spec discovery and lifecycle. Use `list` to discover projects and pass the exact project name to each project-scoped command. Conversations have no execution-project binding. Use the `memory` skill for explicit memory scopes. Obtain locations from command/tool results rather than assuming storage layout.

A bare `battuta-project` invocation displays command help.

## Initialize a project

```sh
battuta-project init <project-name> [--github <repo-url>] [--linear <project-id>,<team-id>]
```

Use `init` once to register a named project, create its managed workspace, and render a summary skeleton. GitHub is optional: without `--github`, the code directory is empty and repository metadata is null. With `--github`, the repository is cloned into that directory. The output reports managed project, code, configuration, and summary locations. Initialization does not select an execution target. Fill the overview from confirmed conversation and available repository evidence during project discovery.

```sh
battuta-project init linth
```

The project name must be a nonblank, nonhidden direct folder name without slashes, backslashes, or NUL. Shell-quote names containing spaces or special characters. For names beginning with `-`, place command options first, then `--` before positional arguments, for example `battuta-project explain -- '-atlas'`. Memory uses explicit project labels in its shared store; no project-local memory store is created. Spec tools operate on managed project storage without requiring GitHub.

The summary has Purpose, Users and use cases, Scope, Current capabilities, and Specifications sections with explicit unknowns. Initialization does not establish spec storage or a constitution. Managed documents are created by spec tools only when requested.

Accepted URL forms include:

```sh
battuta-project init atlas --github https://github.com/team/atlas-api.git
battuta-project init atlas --github git@github.com:team/atlas-api.git
battuta-project init atlas --github ssh://git@github.com/team/atlas-api.git
```

Choose one form for the repository. The `.git` suffix is optional. Use a repository URL, not a branch or file URL; query strings and non-GitHub hosts are rejected.

The project directory name is independent of the repository basename. Initialization never overwrites an existing folder. Use explicit commands for an already registered project. Failed initialization preserves existing projects and removes only the new project directory.

Optionally record existing Linear IDs during initialization:

```sh
battuta-project init linth --linear <project-id>,<team-id>
```

The `--linear` option requires exactly two comma-separated, nonblank IDs in project/team order. Surrounding whitespace is trimmed; quote the value if it contains spaces. Missing components or extra commas are rejected before initialization. Omitting the option leaves both IDs null. The command records supplied IDs locally without a Linear API request. GitHub cloning still uses the network.

## Link GitHub later

```sh
battuta-project github link linth https://github.com/team/linth.git
```

Linking records or replaces GitHub metadata for the named project without a network request. It preserves the project directory, checkout, summary, Linear association, memory, and specs. It does not clone or configure Git remotes; populating or connecting a local Git checkout is a separate operation. The same HTTPS/SSH repository URL forms accepted by `init --github` are supported.

## List registered projects

```sh
battuta-project list
battuta-project list --json
```

The command returns a numbered Markdown list sorted by project name. Each entry has a bold name followed by indented `Project Root` and `Code` lines: the managed project directory and repository checkout, respectively. Paths under the home directory are abbreviated with `~`; other paths remain absolute.

Listing discovers projects from `project.yaml` markers, validates configurations and checkouts, and does not read spec inventories or contact Linear. Hidden directories, symlinked project directories, non-directory entries, and directories without markers are excluded. An absent store reports that no Battuta project store has been initialized; an existing empty registry reports `No registered projects.` Both suggest `battuta-project init <project-name>` and succeed without creating state. A malformed configuration, unsafe marker, or invalid checkout reports an error rather than a partial successful catalog.

For automation, `--json` writes only `{"projects":["atlas","beacon"]}` to stdout, preserving directory spelling and sorting names. A missing or empty registry returns `{"projects":[]}` without creating files. Invalid registrations fail with a nonzero exit and a diagnostic on stderr. Project discovery always uses `~/.battuta/projects`; there is no root override or shared current selection.

## Linear projects

### Link an existing Linear project

```sh
battuta-project linear link <project-name> <project-id>,<team-id>
```

Supply the exact local project name. The association uses the same two-ID comma-separated format as `init --linear`; both IDs are required, trimmed, and must not be blank. Linking replaces any previous Linear association while preserving the project's other settings. It records the supplied IDs locally without querying Linear or verifying that they exist remotely, then reports the local project name and linked project/team IDs.

### Create and link a Linear project

```sh
battuta-project linear create atlas 'Atlas Platform' --team-id <team-id>
```

Supply the local project first, followed by the remote name. The remote name and explicit team ID are required, trimmed, and must not be blank. The command validates the local project, creates a new Linear project associated with the supplied team, then links it to the named local project. It reports the created project's name, ID, and URL, followed by the local project name and linked project/team IDs. Use this command only when a new remote project is needed; use `linear link` for an existing one.

If remote creation succeeds but saving the local link fails, the error includes the created project's ID, URL, and a recovery command containing the exact local project name. Fix the local error, then run the supplied `linear link` command. This saves the link without creating another remote project. Creation is not automatically retried; if a request times out, inspect Linear before trying creation again.

`linear create` and `explain` for a linked project contact Linear. Linking and the initialization options record IDs for the explicit project locally. Different projects can be inspected or updated concurrently without switching shared state. Serialize edits to the same project's associations to avoid overwriting concurrent changes.

## Inspect project context

```sh
battuta-project explain <project-name>
```

Run `explain` with the exact project name before working in its checkout or writing project artifacts. A missing or unknown name is an error, never a fallback to previous work.

The output distinguishes the Managed Project Directory from Project Root (the repository checkout) and reports the Summary path. Unlike `list`, `explain` labels the checkout as `Project Root`. Spec and constitution discovery belong to spec tools and are not included as overview fields.

The Project Summary section displays the managed `SUMMARY.md` as Markdown. Missing or blank summaries show `Project summary: not written yet`; unreadable, invalid UTF-8, symlink, or non-file summaries produce a file error. `explain` never edits the summary or creates artifact directories. Older registrations without a summary remain valid.

The output includes the repository URL and the linked Linear project's URL. Repository information comes from the local configuration; `no GitHub repository linked yet` means it is absent. For a linked project, the command fetches its actual URL from Linear and requires network access and a token with access to that project. An unlinked project shows `not linked` without contacting Linear. Lookup failures are reported as errors; the command does not change the project.

Use the documentation index to find and read applicable `README.md` and `AGENTS.md` files, then work from the displayed Project Root. Documentation paths are relative to that checkout. Discovery is recursive, while the directory tree is limited to two levels. Symlinks, dependencies, and generated directories are excluded.

## Write project documents

Use the [responsibility entries and Workspace binding](../SKILL.md#document-responsibilities) to shape documents. Use [project-spec agent tools](spec-tools.md) for managed specifications, technical plans, tasks, canonical checklists/reviews, and decisions. CoS writes full immutable versions; Manager writes full checklist/review replacements. The CLI does not author specs or record decisions. The project summary can use ordinary file tools at its reported location.

Maintain the overview at the reported Summary path. Inspect the named project's inventory with `inspect_specs` and resolve versions/artifacts through `describe_spec`; no saved version is patched. Existing unregistered documents are preserved. Memory is durable operational context, not the product-decision or specification source of truth.

Existing registrations may lack some scaffold files; `explain` does not write them. Requested authoring establishes missing artifacts and parent directories while preserving existing content; do not rerun `init` against an existing project.

## Record product decisions

CoS uses `finalize_spec` with explicit project/name, go/no-go, and full rationale. The shared agent tool creates `decision.md`, fingerprints the latest spec/checklist/decision/review, and records the terminal outcome in JSON. Read [decision workflow and effects](decisions.md); no review/checklist gate or standalone announcement mail is required. Refinement creates a new version before finalization.

## Recall project and global memory

Use the `memory` skill for scoped tools and autonomous memory management. Recall searches all scopes unless explicitly filtered. Automatic capture classifies individual facts against the project catalog, not a conversation project. Use explicit project memberships for project facts and `global` for genuinely non-project facts; multi-project facts may name several projects. Unknown attribution is omitted/deferred, never made global. Confirm live facts against current evidence.

## Typical workflow

Register a new project and inspect its context:

```sh
battuta-project init atlas-api --github https://github.com/team/atlas-api.git
battuta-project explain atlas-api
```

Register another repository when needed:

```sh
battuta-project init harbor-web --github https://github.com/team/harbor-web.git
battuta-project explain harbor-web
```

Inspect the first project again without changing any shared state:

```sh
battuta-project explain atlas-api
```

Read the relevant repository guidance and memory, work in the checkout returned by `explain`, and provide the project explicitly when persisting project-scoped documents, assignments, notes, or memories.

## Command help

Use `--help` at any command level to check arguments and available subcommands:

```sh
battuta-project --help
battuta-project list --help
battuta-project init --help
battuta-project linear --help
battuta-project linear create --help
```
