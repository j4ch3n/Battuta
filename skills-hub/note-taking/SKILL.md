---
name: note-taking
description: Use when retaining, finding, reading, or revising shared findings and working notes for a project assignment.
---

# Shared working notes

## Objective

Keep recoverable assignment findings and provenance that another participant can
locate and trust.

## Capabilities and boundaries

Keep findings and provenance that would be costly to reconstruct. Notes are
provisional working material, not canonical specifications, commitments,
publication approval, or automatic durable memory. Bots on the same host use the
same assignment file, not separate role notebooks; other hosts have independent
local copies, not synchronized content. Use todo for assignment
discovery and progress; use draft-writing for complete long-form documents.

## Prepare or locate notes

Use the `assignments` MCP service. Both tools require exact `project` and
eight-character `assignment_id` from the commission or bound assignment.
Every note requires an assignment; do not create general/unbound notebooks.

| Tool            | Additional input                                                  | Result                                                                     |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `prepare_notes` | None | Prepare/reuse notes and return their full local path and editing guidance |
| `locate_notes`  | None | Return the full local path and current editable/frozen guidance |

Read the result before opening a file:

- `ok: true`: use the top-level `notes_path` directly with file tools. Do not
  reconstruct it, choose a storage root, or add a role suffix.
- `editable: true`: notes may be created or revised while preserving existing
  material. A returned path is not proof the file or required inputs exist.
- `editable: false`: read existing material only; do not create or edit notes
  or adjacent drafts. A null `notes_path` means no note location is available.
- `ok: false` or a tool error: read the explanation and recovery fields before
  retrying. On `notes_unprepared`, use `prepare_notes` for a nonterminal
  assignment, including blocked work. If local storage configuration is missing,
  ask the operator to fix it; do not guess another root.

Inspect local path safety, create directories/file only if absent, and preserve
existing contents. Use Pi's built-in read/edit/write/search tools at that path;
no note-update CLI or custom editing tool is needed. Freely revise Markdown and
keep sources distinct from inference. Coordinate shared edits to avoid clobbering
another bot's changes; there is no note revision history or automatic undo.

Call `locate_notes` before later edits. When `editable` is false, the assignment
is done/cancelled: read existing material only. Do not create or edit its notes
or adjacent drafts.
On missing files or storage errors, retain existing content and report the
problem; do not silently replace or repair another file.
Local notes and drafts are not remotely readable merely because their reference
is shared. Put complete handoff findings in the execution result and evidence;
report missing required remote content rather than inventing it.

## Worth keeping

- **Measured finding:** retain workload, measurement, source, and limit. “Our
  million-row parsing fixture took 0.8 s versus 80 s; this measures parsing only”
  is useful; “Rust is 100 times faster” is not. These numbers are hypothetical.
- **Decision-changing discovery:** record that a vendor's entry tier excludes
  required audit export, with the checked pricing/documentation source—not a
  diary of searches and page visits.
- **Reusable lesson:** record an observed API permission requirement and the
  evidence that established it—not a troubleshooting transcript or credentials.

Prefer specific findings, sources, decisions, and material limits over generic
knowledge or tool-call logs. Use supplied context for confirmed enduring facts and
return candidate durable findings through the originating result route (the
execution report to Manager for bound work). Use `project-memory` when selected
for supported durable maintenance. Notes must never contain credentials or
unrelated private data.

For example, retain a measured parsing result with workload, source, and limit.
Avoid a diary of commands or credentials. **Why:** provenance lets another reader
judge a finding; a tool transcript is noisy and private data must not be shared.
