# Working notebook commands

Notes preserve learnings, findings, and thoughts beyond the current context.
Numbered search results make relevant details retrievable without loading the
entire notebook. TODOs instead retain intended work and its outcomes. Both are
optional: choose either, both, or neither based on whether they help. A notebook
requires no TODO list and has no task status or completion lifecycle.

Notes are private working material, not canonical specifications, commitments,
approvals, or automatic durable-memory entries. Never store credentials.

## Scope and identity

PM and TL use `battuta-project note` through the shell. `AGENT_ROLE` selects the
owning role (`pm` or `tl`); `--scope` is always explicit:

- `project`: the currently selected registered project. Check `battuta-project
current` and select the intended project with `switch` if needed.
- `general`: no project ownership; works without selecting or registering one.

Each role/scope has an independent notebook. First item or draft creates its work ID;
later appends and session restarts reuse it. Creating or rotating TODO work does
not change the notebook, and appending notes never changes TODO work. Commands
target only the current notebook; there is no rotation or historical selector.
General operations do not change project selection.

## Append a learning, finding, or thought

```sh
battuta-project note --scope general item \
  --text "Finding: Retry-After is expressed in seconds, not milliseconds."
```

`--text` preserves Markdown, Unicode, and surrounding whitespace. Blank input,
NUL, and line separators are rejected explicitly: each note is one physical line.
Appending reports the work reference, file, and the new note's line number.
There are no note edit/delete commands.

## Search and retrieve

```sh
battuta-project note --scope general item --search "Retry-After"
battuta-project note --scope general item --list --from-line 2 --to-line 4
battuta-project note --scope general item --list --from-line 3 --to-line 3
battuta-project note --scope general item --list
```

Search is literal and case-insensitive, not a regular expression. Quote queries
as ordinary shell data. Matching text is concatenated with its source line number:

```text
2. Finding: Retry-After is expressed in seconds, not milliseconds.
```

Search-then-read is available to recover surrounding context. Full reads work too;
neither technique is mandatory. Line numbers start at 1, and ranges include both
endpoints. Omitting `--to-line` reads through the end. Invalid or reversed ranges
fail; a start beyond EOF returns no notes, and an end beyond EOF returns the
available suffix. No search matches is normal success.

## Optional output limits

```sh
battuta-project note --scope general item --search "retry" --limit 5
battuta-project note --scope general item --list --limit 20
```

Without `--limit`, results have no application-level truncation. A limit counts
complete notes or matches, never characters. If more results exist, output says
`Truncated`, provides the next source line and a continuation command preserving
the query, range endpoint, and limit. `--from-line` resumes read or search without
repeating returned notes. Both line numbers and limits must be positive.

Continuation targets the currently selected project/role notebook: verify that
selection has not changed before resuming. External shell/agent output limits can
still clip large results; choose a smaller limit and resume by source line.

## Outcomes and recovery

`item` requires exactly one of `--text`, `--list`, or `--search`. Ranges/limits
are for reads; `--to-line` applies only to listing. Existing `append`, `read`, and
`search --query` commands remain compatible aliases using the same notebook.

Use `battuta-project note --scope general --meta` (or project scope) to discover
notebook identity, item count and draft IDs/titles/paths without loading bodies.
Use the draft-writing skill for complete long-form documents and their retrieval.

Results identify scope/project, role, work reference, file, and numbered text.
Missing notebooks are successful discovery results and create no notebook. Empty
notebooks/ranges return no notes; search reports no matches. Neither falls back to
another role, scope, or older file.

Commands fail noninteractively for missing roles/projects, malformed text, unsafe
paths, incomplete files, or storage errors. Search requires `rg` on the bot's PATH;
append and read do not. Follow the reported error before retrying. A published
notebook whose file is missing is an inconsistency requiring recovery, not a new
empty notebook. Retain files after an interrupted write and ask the owner for
recovery rather than deleting, replacing, or silently repairing their notes.
