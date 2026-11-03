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

1. Select project or general scope explicitly; PM and TL have independent notebooks.
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

## Scope and identity

PM and TL invoke `battuta-project note` through the shell. `AGENT_ROLE` selects
`pm` or `tl`; `--scope` is always explicit:

- `project`: the selected registered project. Check `battuta-project current` and
  select the intended project with `switch` if needed.
- `general`: no project ownership; needs no selected project and does not change
  project selection.

Each role/scope has an independent notebook. The first item or draft creates its
work ID; later appends and session restarts reuse it. TODO creation/rotation never
changes the notebook, and notes never change TODO work. Commands target only the
current notebook; there is no rotation or historical selector.

## Append a learning, finding, or thought

```sh
battuta-project note --scope general item \
  --text "Finding: Retry-After is expressed in seconds, not milliseconds."
```

`--text` preserves Markdown, Unicode and surrounding whitespace. Blank input, NUL
and line separators are rejected: each note is one physical line. Appending reports
the work reference, file and new line number. There are no note edit/delete commands.

## Search and retrieve

```sh
battuta-project note --scope general item --search "Retry-After"
battuta-project note --scope general item --list --from-line 2 --to-line 4
battuta-project note --scope general item --list --from-line 3 --to-line 3
battuta-project note --scope general item --list
```

Search is literal and case-insensitive, not a regular expression. Quote queries
as ordinary shell data. Results include source line numbers:

```text
2. Finding: Retry-After is expressed in seconds, not milliseconds.
```

Search-then-read and full reads are both available; neither is mandatory. Line
numbers start at 1, and ranges include both endpoints. Omitting `--to-line` reads
through the end. Invalid/reversed ranges fail; a start beyond EOF returns no notes,
and an end beyond EOF returns the available suffix. No search matches is success.

## Optional output limits

```sh
battuta-project note --scope general item --search "retry" --limit 5
battuta-project note --scope general item --list --limit 20
```

Without `--limit`, results have no application-level truncation. Limits count
complete notes/matches, never characters. If more results exist, output says
`Truncated` and provides the next source line and a continuation command preserving
the query, range endpoint and limit. `--from-line` resumes reading/search without
repeating notes. Line numbers and limits must be positive.

Continuation targets the current project/role notebook: verify selection has not
changed before resuming. External shell/agent output limits may still clip results;
choose a smaller limit and resume by source line.

## Outcomes and recovery

`item` requires exactly one of `--text`, `--list` or `--search`. Ranges/limits are
for reads; `--to-line` applies only to listing. Existing `append`, `read` and
`search --query` commands remain compatible aliases using the same notebook.

```sh
battuta-project note --scope general --meta
```

Metadata shows notebook identity, item count and draft IDs/titles/paths without
loading bodies. Results identify scope/project, role, work reference, file and
numbered text. Missing notebooks are successful discovery and create nothing.
Empty notebooks/ranges return no notes; searches report no matches. Neither falls
back to another role, scope or older file.

Commands fail noninteractively for missing roles/projects, malformed text, unsafe
paths, incomplete files or storage errors. Search requires `rg` on PATH; append
and read do not. Follow the reported error before retrying. A published notebook
whose file is missing is an inconsistency, not a new empty notebook. Retain files
after interrupted writes and ask the owner for recovery rather than deleting,
replacing or silently repairing notes.
