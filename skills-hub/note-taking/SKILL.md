---
name: note-taking
description: Use when retaining, finding, reading, or revising shared findings and working notes for a project assignment.
---

# Shared working notes

Keep findings and provenance that would be costly to reconstruct. Notes are
provisional working material, not canonical specifications, commitments,
publication approval, or automatic durable memory. All bots use the same file
for a project assignment, not separate role notebooks. Use todo for assignment
discovery and progress; use draft-writing for complete long-form documents.

## Prepare or locate notes

Use the `assignments` MCP service. Both tools require exact `project` and
eight-character `assignment_id`; verify registration with `battuta-project list`.
Every note requires an assignment; do not create general/unbound notebooks.

| Tool | Additional input | Result |
| --- | --- | --- |
| `prepare_notes` | `root`: absolute local Battuta root, with home directory expanded | Establish/reuse the shared path and return initialization/editing guidance |
| `locate_notes` | None | Return the existing path and current editable/frozen guidance |

The root is normally the expanded `~/.battuta`, not its projects subdirectory.
Use the returned `notes_path`; do not invent another location or role suffix.
Preparation returns a plan, not proof that a file exists locally. A conflicting
root fails rather than relocating existing material. If notes are unprepared,
prepare them for the nonterminal assignment first, including blocked work.

Inspect local path safety, create directories/file only if absent, and preserve
existing contents. Use Pi's built-in read/edit/write/search tools at that path;
no note-update CLI or custom editing tool is needed. Freely revise Markdown and
keep sources distinct from inference. Coordinate shared edits to avoid clobbering
another bot's changes; there is no note revision history or automatic undo.

Call `locate_notes` before later edits. When `editable` is false, the assignment
is done/cancelled: read existing material only. Do not create or edit its notes
or adjacent drafts. The freeze is a prompt rule, not a filesystem security lock.
On missing files or storage errors, retain existing content and report the
problem; do not silently replace or repair another file.

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
knowledge or tool-call logs. Use memory for confirmed enduring context. Notes
must never contain credentials or unrelated private data.
