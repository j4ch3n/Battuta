---
name: project-context
description: Use when working on, researching, coding, summarizing, specifying, planning, or building artifacts for a project.
---

# Project context

## Overview

`battuta-project` owns high-level project management: discovery, selection, checkout context, summaries, repository guidance, and Linear association. Use the memory skill for prior project facts, decisions, requirements, implementation context, and project-specific preferences. Personal owner understanding is separate; short project facts do not belong in the owner profile. Project-spec agent tools own spec inventory, versioned documents, checklists/reviews, and terminal decisions. Obtain project/checkout locations from the CLI and document references from spec tools rather than assuming storage layout. Run commands from any directory.

Use `list` to discover projects, `current` to read the selected name, and `switch` to select the intended project. Run `explain` and read applicable README/AGENTS guidance before project work. Use `inspect_specs` with that exact name to discover documents, then `describe_spec` for a named document's details and content. Spec tools use explicit project names and do not change CLI selection.

## Document responsibilities

Select the entry matching the requested responsibility. Read its prompt and, when provided, its template. Each entry is one document collection, not a role-specific workflow or an alternative prompt set.

| Entry                                             | Concept and use                                                                               | Main result                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Summary](references/summary/prompt.md)           | Describe the project as a whole: purpose, users, scope, capabilities, and specification links | `SUMMARY.md`                                 |
| [Specify](references/specify/prompt.md)           | Define what users need and why: requirements, scenarios, and outcomes                         | Named, versioned product spec                |
| [Clarify](references/clarify/prompt.md)           | Resolve ambiguity and incorporate answers into existing requirements                          | New complete spec version                    |
| [Plan](references/plan/prompt.md)                 | Design how the specification will be realized                                                 | Named, versioned technical plan              |
| [Tasks](references/tasks/prompt.md)               | Translate design into concrete, traceable, ordered work                                       | Named, versioned task document               |
| [Checklist](references/checklist/prompt.md)       | Evaluate the quality of written requirements                                                  | Requirements-quality checklist               |
| [Analyze](references/analyze/prompt.md)           | Review consistency and coverage across spec, plan, and tasks                                  | Read-only findings                           |
| [Constitution](references/constitution/prompt.md) | Establish or amend project-wide principles and constraints                                    | Canonical, versioned `Constitution` document |

Summary is project-level; specify is feature-level. Clarify refines existing requirements. Plan makes design decisions; tasks decomposes them. Checklist reviews requirements quality; analyze compares documents. Research, data models, contracts, and quickstarts belong to planning.

Use [project-spec agent tools](references/spec-tools.md) for managed authoring and the [metadata contract](references/spec-metadata.md) for returned spec details. PM persists immutable specification/document versions and terminal go/no-go with rationale. TL supplies technical analysis and authors the canonical checklist/review only. Refinement creates a new version while open. Decisions and hashes live in tool-managed metadata; a product decision alone does not authorize execution.

The seven specification responsibilities preserve original Spec Kit 1.0.13 wording with documented workspace adaptations; see [attribution](references/attribution.md). Summary is project-context-specific.

## Workspace binding

This binding takes precedence over upstream runtime assumptions in the imported prompts and templates. It supplies locations and invocation context, not a replacement authoring methodology.

1. Discover projects with `battuta-project list` and check selection with `current`. Select the intended registered project and run `battuta-project explain`. Read applicable checkout README/AGENTS guidance and relevant memory. Ask which project or feature if the request is ambiguous.
2. Use the CLI's returned checkout and summary locations. Resolve named documents through `inspect_specs` and `describe_spec`; use returned version/artifact references. Spec tools manage document naming and storage. Existing unregistered files are preserved, not silently imported.
3. Treat the current natural-language request as `$ARGUMENTS`, `{ARGS}`, and “User Input.” Slash-command spellings and `__SPECKIT_COMMAND_<NAME>__` tokens name responsibilities in the table above; they are not required user syntax or shell commands. Read the corresponding prompt only when that next responsibility is requested. Implementation, convergence, and issue conversion are not active entries.
4. Read the selected `template.md` and use its document methodology, but persist managed outputs through the owning role's project-spec tools with full content. Upstream instructions to write/patch fixed filenames or create checklist variants are overridden: PM creates immutable named document versions; TL fully replaces the single canonical checklist/review. For constitutions, both roles use `read_constitution`; PM uses `init_constitution`/`update_constitution` for complete versions of the canonical `Constitution` document. The project summary can still use ordinary file tools at its CLI-reported location. Do not install Spec Kit, initialize its infrastructure, or create shared current-feature state.

| Upstream name/path                         | Project-context location                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `FEATURE_DIR`, `SPECIFY_FEATURE_DIRECTORY` | Named product spec's directory returned by describe_spec                                  |
| `SPEC_FILE`, `FEATURE_SPEC`, `SPEC`        | Explicit immutable product-spec version returned by describe_spec                         |
| `IMPL_PLAN`, `PLAN`                        | Explicit version of a separately named technical-plan document                            |
| `TASKS`                                    | Explicit version of a separately named task document                                      |
| Constitution                               | Canonical `Constitution` through `read_constitution`; legacy empty scaffold is not policy |
| Document references in templates           | Actual named versions/artifacts resolved through spec tools                               |
| Source/repository root                     | Repository checkout reported by the CLI                                                   |
| Template resolver output                   | The selected responsibility's shared `template.md`                                        |

Use absolute paths for file operations and relative links in artifacts. State the checkout root when a plan or task list uses source-relative paths. Branch fields are optional checkout metadata; do not create or switch branches merely to author documents. Replace command-reference tokens and input placeholders with ordinary artifact references in finished documents.

Evaluate workflow prerequisites from the actual artifact files and their contents, not slash-command history. Existing manually authored documents can be inputs. Report incomplete or stale artifacts, including a task list that no longer reflects an updated plan; do not silently regenerate them during a review. Upstream research-agent examples use available research tools; when delegation is unavailable, investigate inline rather than installing another agent runtime.

**Inactive upstream integration sections:** do not execute Pre-Execution Checks, Mandatory Post-Execution Hooks, Post-Execution Checks, “Check for extension hooks,” or hook-related Done When items. They are retained original reference text, including any `EXECUTE_COMMAND` markers. No hooks, registry, preset layers, or `.specify/` helper scripts participate in this runtime. The optional branch-creation-via-hook step is likewise inactive.

An empty constitution scaffold is not adopted policy. Apply confirmed project guidance and do not infer approval from files or checkboxes. Follow the existing authority and conversation rules; authoring or reviewing documents does not authorize implementation, issue creation, or a cycle start. Return the requested outcome through the originating conversation, with compact Telegram summaries rather than a template dump.

New project initialization creates a rendered summary skeleton. The shared memory bridge handles memory without project-local memory files. Spec tools establish document storage only when authoring is requested. Older projects may lack artifacts: `explain` stays read-only, while requested authoring creates only what is needed. Complete the summary using its shared Markdown reference rather than guessing product context.

## Tools and command navigation

Use [project-spec tools](references/spec-tools.md) for named specs, canonical checklist/review, and terminal decisions. Both roles inspect spec inventories and documents. All writes receive complete content; there is no spec/decision CLI or publish stage.

Read the relevant [command reference](references/commands.md) section before invocation; it owns syntax, outputs, validation, side effects, and failure/recovery behavior.

| Need                                                       | Command reference                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Start a named project, with or without GitHub              | [Initialize a project](references/commands.md#initialize-a-project)                                                                      |
| Associate a repository later                               | [Link GitHub later](references/commands.md#link-github-later)                                                                            |
| Discover projects or check selection                       | [List projects](references/commands.md#list-registered-projects), [current selection](references/commands.md#read-the-current-selection) |
| Change the project for subsequent work                     | [Switch projects](references/commands.md#switch-projects)                                                                                |
| Read summary, workspace locations, and repository guidance | [Inspect project context](references/commands.md#inspect-project-context)                                                                |
| Associate an existing Linear project or create one         | [Linear projects](references/commands.md#linear-projects)                                                                                |

### Project and global memory

Use the `memory` skill for recall and autonomous memory management. Project memory is bound at request start to the selected registered checkout. A selection change applies to memory on the next request; it does not rebind an in-progress request. Choose project scope for project-specific facts and global scope for personal/cross-project facts; owner approval is not required.

## Workflow example

Use `list` to discover registrations or initialize a new project by name, with or without GitHub. Run `current` to confirm selection, then `explain` and retrieve relevant memory before working in the reported checkout. Use `inspect_specs` with the explicit project name for document discovery. Selection is shared by bots using the same OS account; reselect the intended project before commands if another session may have switched it.

## Reference files

- [Command contracts and two-project examples](references/commands.md)
- Use the `memory` skill for project/global memory scope and tools.
- [Document sources and integration adaptations](references/attribution.md)
