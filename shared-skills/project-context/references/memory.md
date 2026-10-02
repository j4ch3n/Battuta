# Durable project memory

Store stable decisions, rationale, and standing constraints in the selected project's `MEMORY.md`. Check current repository and issue-tracker evidence for live facts. Memory is not a ticket-status record or a copy of repository instructions. A short ticket identifier can help trace a decision; avoid ticket URLs and transient progress.

## Commands

| Command      | Usage                                                     | Output and process                                                                              |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `append`     | `battuta-project memory append 'Use PostgreSQL.'`         | Append one trimmed, non-empty line; report its 1-based index                                    |
| `get`        | `battuta-project memory get`                              | Return full memory with `1: content` indexes; report no memory when empty or absent             |
| `replace`    | `battuta-project memory replace 2 'Run migration tests.'` | Replace exactly one existing line, preserving other entries                                     |
| `replaceAll` | `battuta-project memory replaceAll 'Complete memory'`     | Split into lines, trim each line, drop empty lines, replace full memory, and report entry count |

All commands use the current project, without a project argument. Indexes are displayed, not stored. `append` and `replace` reject empty or multiline content; indexes start at 1 and must refer to an existing line. File updates are atomic. Run memory edits serially; concurrent read-modify-write edits are not merged automatically.

Existing memory is read without trimming or removing blank lines, so legacy blank lines receive indexes. Only `replaceAll` performs whole-file cleanup. Empty normalized input clears memory.

## Example: edit and reconcile Atlas API

```sh
battuta-project switch atlas-api
battuta-project memory append 'Use PostgreSQL for durable application data.'
```

```text
Appended memory line 1 for atlas-api.
```

```sh
battuta-project memory append 'Run API tests before merging.'
```

```text
Appended memory line 2 for atlas-api.
```

```sh
battuta-project memory get
```

```text
1: Use PostgreSQL for durable application data.
2: Run API tests before merging.
```

```sh
battuta-project memory replace 2 'Run API and migration tests before merging.'
```

```text
Replaced memory line 2 for atlas-api.
```

For reconciliation, first retrieve existing memory, retain still-relevant decisions, resolve duplication/conflicts against current evidence, then pass the full revised content as one quoted argument. Remove the displayed `1:`/`2:` prefixes; `replaceAll` treats its argument as ordinary text.

```sh
battuta-project memory replaceAll '  PostgreSQL is the durable application store.

  Run API and migration tests before merging.  '
```

```text
Replaced all memory for atlas-api: 2 lines.
```

```sh
battuta-project memory get
```

```text
1: PostgreSQL is the durable application store.
2: Run API and migration tests before merging.
```

Switching to `harbor-web` uses its independent memory. A fresh Harbor project returns `No memory for harbor-web.`; append its own decisions there.
