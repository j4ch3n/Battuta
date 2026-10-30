# Working notebook persistence

Implementation reference for append-only items and editable draft documents.
Bot-facing item usage belongs in the [notebook command reference](../shared-skills/note-taking/references/commands.md).

## Identity and storage

Project notebooks live in `~/.battuta/projects/<project>/work/`; general notebooks
in `~/.battuta/work/`. Filenames are `note-<pm|tl>-<work-id>.md`, alongside TODO
files. There is no fallback or migration from the old `todos/` directory.

`WorkContext` shares role/scope resolution, registry-first locking, and five-character
ID allocation with TODOs. Allocation reserves retained metadata and notebook/TODO
paths for both roles, including symlinks and crash orphans. It retries at most 100
times. IDs share a format, not a mandatory relationship.

In `~/.battuta/projects/.config.json`, `currentNoteWorkId` under
`projects.<project>.roles.<role>` or `general.roles.<role>` selects the notebook.
Its ID is retained in that role's existing `works` mapping. Publication reuses the
registry's validated read/modify/write, preserving unknown metadata, TODO
`currentWorkId`, associations, and other roles/scopes. No notebook rotation or
historical selector is exposed in V1.

## File and concurrency contract

Each UTF-8 note is a nonblank physical line ending in LF. Input is validated before
creating storage. CR, NUL, Unicode line separators, and invalid UTF-8 are rejected;
other text is preserved. Reads validate the same contract. Empty files are valid,
but missing published files, malformed records, and unterminated final lines fail
without silent repair. Line numbers start at 1 and remain stable under append.

Operations acquire `<registry>/.config.lock`, then `.work-<role>.lock` in the work
directory. The registry lock serializes first publication and preserves independent
selections during concurrent TODO creation or project switching. File/directory
checks reject symlinks and nonregular targets; descriptors use `O_NOFOLLOW` and
validate regular-file status. New notes files use mode `0600`.

First mutation exclusively creates and fsyncs an empty item file, writes its index,
then publishes the notebook pointer. Ordinary publication failure removes only the new
unpublished files. A crash between writes may leave an orphan; it stays unselected
and reserves its ID. Later appends use `O_APPEND`, flush/fsync before success, and
never rewrite existing items or update config. An interrupted/failed physical write
may leave an incomplete suffix; validation then blocks further operations pending
owner recovery. An append failure can leave an empty published notebook; inspect
current state before retrying. This is recoverable publication, not a transaction.

## Notebook metadata and drafts

`note-<role>-<work-id>.json` is the notebook index above the independent item and
draft collections. Schema 1 records `schemaVersion`, `scope`, `role`, nullable
`project`, `workId`, relative `itemFile`, `nextDraftId`, and `drafts`. Each draft
has increasing `id`, single-line `title`, relative `file`, and UTC `createdAt`.
Counts, availability and bodies are derived, not duplicated in metadata. Unknown
fields survive writes; invalid identities/schema/paths fail without repair.

Legacy notebooks without an index remain readable without creating one. A first
mutation writes the index under the existing registry/work locks without changing
identity, item bytes, numbers, TODO state or unrelated registry fields. Published
missing item files are errors even if drafts exist.

Draft creation accepts full UTF-8 stdin, rejects blank/NUL/invalid input, and saves
it verbatim to `note-<role>-<work-id>-draft-<id>.md` with exclusive creation and
mode `0600`. The file is flushed/fsynced before atomic metadata registration.
Only registration earns success. Failure after creation retains and identifies
the unregistered file; later creates skip occupied names instead of overwriting
or adopting them. Gaps are permitted; registered IDs never renumber or reuse.

Creation reports the absolute file path and full content. Drafts are ordinary
editable files: agent read/edit tools update that path directly. There is no CLI
editing, patch engine, backup, history or automatic publication. List/get inspect
current files, not creation-time snapshots. Missing registered files remain
listed as missing and fail retrieval with their expected path; permission,
symlink/nonregular-target and invalid-content errors are not labelled missing.

CLI locks coordinate CLI operations, not external editor writes. Direct edits
have the editing tool's concurrency/durability guarantees and no built-in undo.
Neither fsync nor atomic rename makes the Markdown/index/registry a crash-atomic
multi-file transaction; directory fsync and automatic orphan recovery are not
provided. Keep retained files for explicit recovery.

## Reads and search

Reads stream validated lines; optional limits retain complete records and one
continuation source line. Validation scans the file even for a limited result.
There is no implicit text truncation or default limit.

Search validates the notebook and invokes upstream [ripgrep](https://github.com/BurntSushi/ripgrep)
(MIT/Unlicense) with a subprocess argument list, `--no-config --json --fixed-strings
--ignore-case --text --encoding none -e QUERY -- FILE`. Encoding detection is
disabled so a leading Unicode BOM remains literal note text. Matching is delegated to ripgrep; no index
or Python matcher exists. JSON match records provide source numbers and full text.
Exit 1 is a normal no-match result; other nonzero statuses and malformed output
fail explicitly. Search limits count matching lines, not source lines.

Search captures ripgrep output before pagination, and validation/append scan existing
notes. This intentionally favors simple, safe working notebooks over an index; very
large notebooks may need a streaming search implementation in a later change.

## Verification

The project-context CLI's unit tests and `tests/project_work.it.py` cover independent identities, text/range
validation, exact byte preservation, safe paths, restarts, parallel first appends,
parallel TODO/notebook publication, allocation/publication failures, literal query
handling, real ripgrep, and CLI continuations through real `battuta-project`
subprocesses. Run both with `pnpm check:support`; bare unittest discovery runs only
the unit tests. No deployment on Pi hardware or live bot session is implied by those tests.
