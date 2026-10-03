---
name: project-context
description: Use when working on, researching, coding, summarizing, specifying, planning, or building artifacts for a project.
---

# Project context

## Overview

`battuta-project` manages project checkouts, displays project summaries and artifact locations, indexes repository guidance, and stores durable project memory shared by agents. Before project work, select the intended project, run `explain`, and read the relevant README/AGENTS files. Run commands from any directory after [installation](references/installation.md).

## Document responsibilities

Select the entry matching the requested responsibility. Read its prompt and, when provided, its template. Each entry is one document collection, not a role-specific workflow or an alternative prompt set.

| Entry                                             | Concept and use                                                                               | Main result                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| [Summary](references/summary/prompt.md)           | Describe the project as a whole: purpose, users, scope, capabilities, and specification links | `SUMMARY.md`                         |
| [Specify](references/specify/prompt.md)           | Define what users need and why: requirements, scenarios, and outcomes                         | Named, versioned product spec        |
| [Clarify](references/clarify/prompt.md)           | Resolve ambiguity and incorporate answers into existing requirements                          | New complete spec version            |
| [Plan](references/plan/prompt.md)                 | Design how the specification will be realized                                                 | Named, versioned technical plan      |
| [Tasks](references/tasks/prompt.md)               | Translate design into concrete, traceable, ordered work                                       | Named, versioned task document       |
| [Checklist](references/checklist/prompt.md)       | Evaluate the quality of written requirements                                                  | Requirements-quality checklist       |
| [Analyze](references/analyze/prompt.md)           | Review consistency and coverage across spec, plan, and tasks                                  | Read-only findings                   |
| [Constitution](references/constitution/prompt.md) | Establish or amend project-wide principles and constraints                                    | Named, versioned principles document |

Summary is project-level; specify is feature-level. Clarify refines existing requirements. Plan makes design decisions; tasks decomposes them. Checklist reviews requirements quality; analyze compares documents. Research, data models, contracts, and quickstarts belong to planning.

Use [project-spec agent tools](references/spec-tools.md) for managed authoring and [metadata layout](references/spec-metadata.md) for version/artifact locations. PM persists immutable specification/document versions and terminal go/no-go with rationale. TL supplies technical analysis and authors the canonical checklist/review only. Refinement creates a new version while open. Decisions and hashes live in `specs/index.json`; a product decision alone does not authorize execution.

The seven specification responsibilities preserve original Spec Kit 1.0.13 wording with documented workspace adaptations; see [attribution](references/attribution.md). Summary is project-context-specific.

## Workspace binding

This binding takes precedence over upstream runtime assumptions in the imported prompts and templates. It supplies locations and invocation context, not a replacement authoring methodology.

1. Select the intended registered project and run `battuta-project explain`. Read applicable checkout README/AGENTS guidance and relevant memory. Ask which project or feature if the request is ambiguous.
2. Retain the reported Managed Project Directory, Project Root (the checkout), Summary, and Specs Root. Resolve exact named documents through `read_project_metadata` and `describe_spec`; use returned version/artifact paths. Named folders replace newly authored `NNN-short-name` feature scaffolds. Existing unregistered files are preserved, not silently imported.
3. Treat the current natural-language request as `$ARGUMENTS`, `{ARGS}`, and “User Input.” Slash-command spellings and `__SPECKIT_COMMAND_<NAME>__` tokens name responsibilities in the table above; they are not required user syntax or shell commands. Read the corresponding prompt only when that next responsibility is requested. Implementation, convergence, and issue conversion are not active entries.
4. Read the selected `template.md` and use its document methodology, but persist managed outputs through the owning role's project-spec tools with full content. Upstream instructions to write/patch fixed filenames or create checklist variants are overridden: PM creates immutable named document versions; TL fully replaces the single canonical checklist/review. Summary outside Specs Root can still use ordinary file tools. Do not install Spec Kit, initialize its infrastructure, or create shared current-feature state.

| Upstream name/path                         | Project-context location                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `FEATURE_DIR`, `SPECIFY_FEATURE_DIRECTORY` | Named product spec's directory returned by describe_spec                      |
| `SPEC_FILE`, `FEATURE_SPEC`, `SPEC`        | Explicit immutable product-spec version returned by describe_spec             |
| `IMPL_PLAN`, `PLAN`                        | Explicit version of a separately named technical-plan document                |
| `TASKS`                                    | Explicit version of a separately named task document                          |
| Constitution                               | Latest adopted named principles document; legacy empty scaffold is not policy |
| `/specs/...` in templates                  | Under the reported Specs Root, not a filesystem-root or checkout path         |
| Source/repository root                     | Project Root, the `code/` checkout                                            |
| Template resolver output                   | The selected responsibility's shared `template.md`                            |

Use absolute paths for file operations and relative links in artifacts. State the checkout root when a plan or task list uses source-relative paths. Branch fields are optional checkout metadata; do not create or switch branches merely to author documents. Replace command-reference tokens and input placeholders with ordinary artifact references in finished documents.

Evaluate workflow prerequisites from the actual artifact files and their contents, not slash-command history. Existing manually authored documents can be inputs. Report incomplete or stale artifacts, including a task list that no longer reflects an updated plan; do not silently regenerate them during a review. Upstream research-agent examples use available research tools; when delegation is unavailable, investigate inline rather than installing another agent runtime.

**Inactive upstream integration sections:** do not execute Pre-Execution Checks, Mandatory Post-Execution Hooks, Post-Execution Checks, “Check for extension hooks,” or hook-related Done When items. They are retained original reference text, including any `EXECUTE_COMMAND` markers. No hooks, registry, preset layers, or `.specify/` helper scripts participate in this runtime. The optional branch-creation-via-hook step is likewise inactive.

An empty constitution scaffold is not adopted policy. Apply confirmed project guidance and do not infer approval from files or checkboxes. Follow the existing authority and conversation rules; authoring or reviewing documents does not authorize implementation, issue creation, or a cycle start. Return the requested outcome through the originating conversation, with compact Telegram summaries rather than a template dump.

New project initialization creates a rendered summary skeleton, empty `MEMORY.md`, and `specs/constitution.md`. Older projects may lack these: `explain` stays read-only, while requested authoring creates only needed artifacts and parent directories. Complete the summary using its shared Markdown reference rather than guessing product context.

`linear create` and `explain` for a linked project contact Linear; GitHub initialization still clones over the network.

## Commands

### Agent document tools

Use [project-spec tools](references/spec-tools.md) for named specs, canonical checklist/review, and terminal decisions. Both roles read project/spec metadata. All writes receive complete content; there is no spec/decision CLI or publish stage.

### `battuta-project init <github-repo-url>`

**Usage:** `battuta-project init https://github.com/team/atlas-api.git`

**Output:** Project root, checkout, config, summary, memory, specs and constitution locations, and current selection.

**Process:** Clone with `gh` into a managed checkout, render the `SUMMARY.md` skeleton from the packaged Jinja template, create empty `MEMORY.md` and `specs/constitution.md`, then select the project. Fill the overview during project discovery. Already registered names cause an error; failed initialization preserves the previous selection.

**Linear metadata:** Optional `--linear-project-id <id>` and `--linear-team-id <id>` record existing IDs without querying Linear. Each omitted field defaults to `null`.

### `battuta-project switch <project-name>`

**Usage:** `battuta-project switch atlas-api`

**Output:** Current project and checkout location.

**Process:** Select a registered project by its exact name after validating its checkout. A missing project causes an error. This does not change the shell directory.

### `battuta-project explain`

**Usage:** `battuta-project explain`

**Output:** Managed Project Directory, Project Root (the checkout), Specs Root, Summary and Constitution paths, full project summary, repository URL, Linear project URL, relative README/AGENTS locations, and a two-level ASCII directory tree.

**Process:** Use the current project; read its managed `SUMMARY.md` without editing it. Missing/blank summaries show `not written yet`; artifact paths are reported even before documents exist. Discover nested checkout documentation recursively while excluding dependencies, generated directories, and symlinks. Fetch the linked project's URL from Linear; an unlinked project shows `not linked` without a request. Lookup or summary-read failures cause an error. Read applicable instructions before working in the displayed Project Root.

### `battuta-project linear <operation>`

| Operation | Usage                                                           | Behavior                                                                                                     |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `link`    | `battuta-project linear link --project-id <id> --team-id <id>`  | Associate both IDs with the current project; no Linear request.                                              |
| `create`  | `battuta-project linear create 'Atlas Platform' --team-id <id>` | Create a Linear project, print its ID/URL, and link it to the current local project. Explicit team required. |

IDs and creation names must not be blank. Linear project and team associations belong to the selected project. If creation succeeds but local saving fails, fix the local error and use the error's `switch`/`linear link` recovery commands rather than creating a duplicate. After a creation timeout, inspect Linear before retrying. See [command contracts](references/commands.md#linear-projects).

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
- [Document sources and integration adaptations](references/attribution.md)
