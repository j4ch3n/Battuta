---
name: draft-writing
description: Use when saving, finding, retrieving, or revising complete working documents such as articles, research memos, outlines, or proposals, with or without a project.
---

# Working drafts

Save a complete long-form document once, then use ordinary file tools to revise
it. Drafts are private provisional material, not approved specifications or
published artifacts. Research and editorial judgement belong to the task at hand.

## Workflow

1. Choose project or general scope explicitly; use PM's notebook.
2. Pipe the complete document to creation with a descriptive title. The CLI assigns
   its ID and registers the file automatically; do not fabricate bookkeeping.
3. Creation returns the absolute path and full content. Read/edit that path with
   existing agent file tools. Keep the file at its registered path; later retrieval
   reads current content. There is no history, backup, or built-in undo.
4. List drafts to recover their IDs, titles, paths and availability, then get the
   desired document. Retain missing references and follow reported errors rather
   than silently replacing a missing draft.

Use note-taking for short findings and provenance, todo for intended steps, and
memory for confirmed enduring context. None is required to create a draft.
Publication or canonical-document authoring remains a separate authorised action.

## Scope

PM invokes `battuta-project note` through the shell with `AGENT_ROLE=pm`.
Project scope uses the selected registered project: confirm `battuta-project current`
and switch if necessary. General scope needs no project and does not change selection.
PM has independent project/general notebooks; scope is always explicit.

## Create a complete document

```sh
cat article.md | battuta-project note --scope project draft --title "Buyer economics"
```

Pipe complete nonblank UTF-8 content on stdin. Multiline Markdown, Unicode and
the final-newline state are preserved. Titles must be nonblank single lines;
NUL and invalid encoding are rejected. Creation without piped input fails rather
than waiting for interactive input.

Creation assigns an incrementing notebook-local ID, saves and registers the file,
and reports:

```text
Draft 3 saved to /absolute/path/to/draft.md

...complete content...
```

Titles need not be unique. Use the returned path with ordinary read/edit tools;
do not recreate a draft just to revise it. Registration stays unchanged. There
are no CLI edit, patch, rename or delete commands. Coordinate concurrent edits;
CLI protection does not cover external editor writes.

## Discover and retrieve

```sh
battuta-project note --scope project draft --list
battuta-project note --scope project draft --get 3
battuta-project note --scope project --meta
```

List returns IDs, titles, availability and absolute paths, not bodies. Get returns
the full current document without a wrapper or automatic truncation. IDs start
at 1, stay stable and never renumber; gaps are possible. Metadata shows notebook
identity, counts and references without bodies. Item-note listing never expands
drafts. Choose exactly one of `--title`, `--list` or `--get`; IDs must be positive.

## Failures and recovery

- No notebook or no drafts is successful discovery, with no creation.
- Unknown IDs are errors. A missing registered file is a distinct error identifying
  its ID/title/path; its reference is retained. List marks it missing rather than
  omitting or replacing it.
- Permission failures, unsafe paths, invalid content and storage errors fail
  explicitly. Keep files and follow the reported recovery guidance.
- Failed registration after saving identifies a retained unregistered file. Inspect
  it and list drafts before retrying. Do not assume failure saved nothing or delete
  retained files to clear the error.
- If a response was lost, list before repeating creation; the save may have succeeded.
  The CLI does not deduplicate titles or adopt stray files.

Keep secrets and unrelated private data out. Creation does not publish a URL,
approve requirements, update Linear or create durable memory.
