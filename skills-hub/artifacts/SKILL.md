---
name: artifacts
description: Use when creating a project-owned presentation, using a reference template, publishing or managing a draft, serving existing Markdown, or discovering, updating or withdrawing an artifact.
---

# Artifacts

Use `battuta-artifact` for project-owned creation and explicit publication. Read the [command reference](references/commands.md) before operations; it owns command flags, results and withdrawal semantics. Use `present-to-owner` for narrative and format decisions.

## Choose a reference template

| Template     | When it helps                                               | What powers it                                                                                                               |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `report`     | Self-paced explanation, substantial evidence or comparisons | Responsive HTML/CSS; native SVG plots and local Three.js for 3D                                                              |
| `slides`     | Explicit deck or presenter-guided sequence                  | Fixed 1920×1080 HTML/CSS stage; navigation, SVG plots and local Three.js for 3D                                              |
| `live-panel` | Illustrative system state and relationships                 | Existing live-panel runtime; deterministic simulated counters/log, optional semantic layout helper, play/pause and scrubbing |

These are complete working reference implementations, not authoring restrictions. Adapt, replace, remove or extend any files, layouts, scripts or assets to best present the content. Dependencies are already wired; returned file purposes and the copied `USAGE.md` explain the examples. Illustrative data is not evidence.

## Create, prepare and publish

1. Establish the owning registered project from the explicit request or unambiguous context. If unspecified or ambiguous, ask **before creating files or draft records**. Current selection alone is not evidence of ownership; do not choose a global fallback or create a project. Procurement research belongs to procurement; a Battuta chief-of-staff proposal belongs to Battuta. Use `project-context` for discovery if needed, not to infer ownership from selection.
2. Run `init` with that explicit project, name, title and description. It returns a **draft**, its actual absolute directory, guidance and an annotated file tree. Use ordinary file tools at that returned location; do not guess destinations or move files afterward. No public preview URL exists for a draft.
3. Prepare the presentation freely. New files are not automatically shared. When replacing/removing original assets, use `replace-files` with the **complete desired runtime file set**, retaining the presentation entry. Never recursively share a folder or include credentials, private notes or unrelated sources.
4. Confirm intended sharing scope, then `publish` the existing draft. Inspect JSON status and URLs. A successful publication is not proof the service, tunnel or every asset works: check the local URL and actual browser behavior before claiming delivery. Distinguish local verification from external accessibility.
5. For metadata changes use `update`; for file-list changes inspect `show` and use `replace-files` with the observed revision. Published original-file edits are live immediately; this is not a versioned publication system.

## Existing Markdown and withdrawal

For an explicit request to serve an **existing** Markdown file, use `add-file --type markdown` with its absolute path. This publishes it immediately in place; it is not a draft/private-preview command. Do not initialize a template, copy/move the source or create a project. Confirm sharing scope first.

Use `deregister` to withdraw discovery and subsequent HTTP access without deleting originals or recalling downloaded content.

On a revision conflict, inspect again before retrying. On missing setup or unavailable source files, report the blocker; do not edit SQLite, copy files, or change service configuration as a workaround.
