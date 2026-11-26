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
publication approval, or automatic durable memory. Use todo for assignment
discovery and progress; use draft-writing for complete long-form documents.

## Prepare or locate notes

Use the `assignments` MCP service. Both tools require exact `project` and
eight-character `assignment_id` from the commission or bound assignment.
Every note requires an assignment; do not create general/unbound notebooks.

Call `prepare_notes` to prepare notes or `locate_notes` to find them. Follow the
tool's response before accessing or editing files, and call `locate_notes` before
later edits. Preserve existing material, distinguish sources from inference, and
report inaccessible required inputs. Put complete handoff findings in the
execution result and evidence.

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
execution report to Manager for bound work); memory is written only by the
nightly dream. Notes must never contain credentials or
unrelated private data.

For example, retain a measured parsing result with workload, source, and limit.
Avoid a diary of commands or credentials. **Why:** provenance lets another reader
judge a finding; a tool transcript is noisy and private data must not be shared.
