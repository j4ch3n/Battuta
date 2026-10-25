# Working notebook persistence

Implementation reference for append-only agent notes. Bot-facing usage belongs
in the [notebook command reference](../shared-skills/project-context/references/task-notes.md).

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

First append exclusively creates the file, writes/fsyncs its first line, then
publishes the notebook pointer. Ordinary publication failure removes only the new
unpublished file. A crash between writes may leave an orphan; it stays unselected
and reserves its ID. Later appends use `O_APPEND`, flush/fsync before success, and
never rewrite existing notes or update config. An interrupted/failed physical write
may leave an incomplete suffix; validation then blocks further operations pending
owner recovery. This is recoverable publication, not a two-file transaction.

## Reads and search

Reads stream validated lines; optional limits retain complete records and one
continuation source line. Validation scans the file even for a limited result.
There is no implicit text truncation or default limit.

Search validates the notebook and invokes upstream [ripgrep](https://github.com/BurntSushi/ripgrep)
(MIT/Unlicense) with a subprocess argument list, `--no-config --json --fixed-strings
--ignore-case --text -e QUERY -- FILE`. Matching is delegated to ripgrep; no index
or Python matcher exists. JSON match records provide source numbers and full text.
Exit 1 is a normal no-match result; other nonzero statuses and malformed output
fail explicitly. Search limits count matching lines, not source lines.

Search captures ripgrep output before pagination, and validation/append scan existing
notes. This intentionally favors simple, safe working notebooks over an index; very
large notebooks may need a streaming search implementation in a later change.

## Verification

The project-context CLI's unittest suite covers independent identities, text/range
validation, exact byte preservation, safe paths, restarts, parallel first appends,
parallel TODO/notebook publication, allocation/publication failures, literal query
handling, real ripgrep, and executable CLI continuations. No deployment on Pi
hardware or live bot session is implied by those tests.
