---
name: note-taking
description: Use when retaining short findings, learnings, or thoughts across context changes, or searching and retrieving numbered working notes, with or without a project.
---

# Working notes

Retain short findings and their provenance so they can be recovered without
reconstructing the investigation. Notes are optional private working material,
not canonical specifications, commitments, approvals, or automatic durable memory.

## What is worth keeping

Keep findings that help future work: specific, relevant to the task or owner,
grounded in evidence, and concise enough to reuse without reconstructing the
investigation. Prefer information costly to rediscover over generic knowledge.
Record what was learned, not merely what happened. Novelty alone is not enough.

These examples are hypothetical; their measurements, sources, and API behaviour
illustrate note quality, not verified facts. Use actual evidence in real notes.

### 1. A measured finding, not a sweeping claim

**Bad:** “Researched performance. Rust is about 100× faster than Python.”

**Good:** “For our 1-million-row import fixture, the Rust prototype took 0.8 s
versus Python's 80 s on the same machine; this measures parsing only, not database
writes. Source: benchmark run and script.”

**Why:** Preserves the workload, measurement, source, and limit. Useful for this
project without turning one benchmark into a universal language claim.

### 2. A relevant discovery, not a search log

**Bad:** “Searched three vendors, read their pricing pages, and updated the
comparison.”

**Good:** “Vendor A's entry plan excludes audit-log export, which our compliance
requirement needs; the apparent lowest-price option therefore requires a higher
tier. Source: pricing page and export documentation, checked today.”

**Why:** Retains the decision-changing discovery and its evidence, rather than
the actions taken. Someone resuming the comparison knows what matters.

### 3. A reusable lesson, not a troubleshooting diary

**Bad:** “The request failed. Retried twice, changed the token, and got it working.”

**Good:** “This API returns 403 when the token lacks `events:read`, even with a
valid login; verify that scope before rotating credentials. Source: failed
response and successful retry after adding the scope.”

**Why:** Captures the symptom, established cause, and useful next-time check.
Avoids preserving credentials or unnecessary debugging chronology.

## Workflow

1. Read the [command reference](references/commands.md) before invocation. Select
   project or general scope explicitly; PM and TL have independent notebooks.
2. Append one physical line per finding, including its source and material limits
   where relevant. Preserve the distinction between evidence and inference.
3. Search for relevant terms, then read surrounding numbered lines when useful.
   Full reads are also available; use limits and returned continuation commands
   for large notebooks. Use `--meta` to discover notebook identity and registered
   drafts without loading their bodies; PM uses draft-writing for complete documents.
4. On a storage error, retain existing content and follow the reported recovery
   guidance rather than replacing or silently repairing it.

Use the memory skill for confirmed enduring context, not temporary research state.
A notebook needs no TODO list. Keep credentials and unrelated private data out.
