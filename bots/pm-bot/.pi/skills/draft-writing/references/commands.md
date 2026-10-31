# Draft commands

PM invokes `battuta-project note` through the shell with `AGENT_ROLE=pm`.
PM has independent project/general notebooks. Project scope
uses the selected registered project: confirm `battuta-project current` and switch
if necessary. General scope needs no project and does not change selection.

## Create a complete document

```sh
cat article.md | battuta-project note --scope project draft --title "Buyer economics"
```

Pipe complete nonblank UTF-8 content on stdin. Multiline Markdown, Unicode and
the final-newline state are preserved. Titles must be nonblank single lines;
NUL and invalid encoding are rejected. Interactive creation without piped input
fails rather than waiting for terminal input.

The CLI assigns an incrementing notebook-local ID and automatically saves and
registers the file. Titles need not be unique. Creation reports:

```text
Draft 3 saved to /absolute/path/to/draft.md

...complete content...
```

Use the actual returned path, not this example. Once created, use ordinary agent
read/edit tools on that file; do not recreate it merely to revise the content.
The ID/title/path registration stays unchanged. There are no CLI edit, patch,
rename, delete, history or backup commands, and no built-in undo. Coordinate
concurrent edits rather than assuming the CLI protects external editor writes.

## Discover and retrieve

```sh
battuta-project note --scope project draft --list
battuta-project note --scope project draft --get 3
battuta-project note --scope project --meta
```

List returns IDs, titles, current file availability and absolute paths, not bodies.
Get returns the full current document without a wrapper or automatic truncation.
IDs start at 1, remain stable and never renumber; gaps are possible. Notebook
metadata shows identity, counts and references without loading document bodies.
Item-note listing never expands drafts. Choose exactly one of `--title`, `--list`
or `--get`; IDs must be positive integers and scope is always required.

## Failures and recovery

- No notebook or no drafts is a successful discovery result, with no creation.
- An unknown ID is an error. A registered file that is missing is a different
  error identifying its ID/title/path; its reference is retained. List marks it
  missing instead of silently omitting or replacing it.
- Permission failures, unsafe paths, invalid content and storage errors fail
  explicitly. Keep existing files and follow the reported recovery guidance.
- Failed registration after saving identifies a retained unregistered file. Inspect
  it and list registered drafts before retrying. Do not assume a failed command
  saved nothing or delete retained files to clear the error.
- If a response was lost, list drafts before repeating creation; the earlier save
  may have succeeded. The CLI does not deduplicate titles or adopt stray files.

Keep secrets and unrelated private data out. Draft creation does not publish a URL,
approve requirements, update Linear, or create durable memory.
