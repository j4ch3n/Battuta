# Memory tool reference

Every tool returns `{ok: true, data}` or
`{ok: false, error: {code: invalid_request | backend_unavailable, message}}`.
Errors never include internal paths or raw exceptions.

## Read tools (`/mcp` and `/mcp/read`)

| Tool                          | Arguments                                                                  | `data`                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `memory_recall`               | `projects?: string[]`, `types?: string[]`, `query?: string`, `limit?: int` | `{status: "ok", memories: [{name, type, project, abstract, body, updated}]}` or `{status: "invalid", projects, types}`       |
| `memory_types`                | none                                                                       | `{types: [{type, description}]}` (overview excluded)                                                                         |
| `memory_project_overview`     | `project: string`                                                          | `{status: "ok", overview: {abstract, body, created}}`, `{status: "not_written"}`, or `{status: "unknown_project", projects}` |
| `memory_project_descriptions` | `projects?: string[]`                                                      | `{descriptions: {<project>: abstract or null}}`                                                                              |

`global` is a valid project for the owner's personal memories. Project names
match the `battuta-project` catalog, ignoring case and spacing.

## CoS tools (`/mcp` only)

| Tool                  | `data`                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `memory_profile`      | `{status: "ok", body}` (the global overview) or `{status: "not_written"}`                                         |
| `memory_dream_start`  | `{status: "started"}` or `{status: "already_running"}`                                                            |
| `memory_dream_status` | `{status: idle \| running \| succeeded \| failed, step, started_at, finished_at, last_success_at, error, report}` |
| `memory_health`       | `{ready, projects}` (catalog size)                                                                                |
| `memory_forget`       | `{results: [{slug, result: forgotten \| superseded \| no-op, invalid_at, successor?}]}` (see below)               |

### `memory_forget`

CoS calls `memory_forget` only when the owner confirms or instructs it. It
marks memories obsolete by ending their validity interval. The file is kept
and is never deleted, and there is no undo tool. Recall stops returning the
entry, but historical reads still find it.

Arguments:

- `entries`: 1 to 25 items `{slug, successor?}`, both non-empty strings.
  - Without `successor`, the entry is forgotten (`result: "forgotten"`).
  - With `successor`, the entry is superseded by that active memory
    (`result: "superseded"`, `superseded_by` set).
- `reason`: why the entries are obsolete.
- `owner_confirmation`: the owner's confirmation or instruction, quoted or
  summarised.

Each result has `invalid_at`, the ISO time the entry stopped being valid. An
entry that was already invalid returns `no-op` with its existing `invalid_at`
and is not changed.

The whole call is validated before anything is written. It fails with
`invalid_request` and no writes when:

- `entries` is not a list of 1 to 25 `{slug, successor?}` items, or an item
  has an empty value or extra keys;
- `reason` or `owner_confirmation` is missing or blank;
- a slug is repeated, a successor equals its own slug, or a successor is also
  being forgotten in the same call;
- a memory dream is running;
- any slug is unknown (all unknown slugs are listed);
- a successor is missing or no longer valid.

If a write fails part-way through (for example a concurrent change), the error
is `invalid_request` and names the entries already applied.

Every actual forget (not a `no-op`) appends one line to the decisions ledger,
`dream-reports/decisions.md`. The id is `forget:<slug>` and the verdict is
`accepted`. The detail is one-line JSON with `action`, `invalid_at`,
`successor`, `reason`, `owner_confirmation` and `by: "cos"`.

## CoS Pi tools

The CoS memory client registers these for CoS's model:

- `memory_recall {projects?, types?, query?}` and `memory_types`: the read tools above.
- `memory_dream`: extract and upload the conversation, start the dream, wait for
  it, and return `{status, step, error, uploaded, memories_written, consolidation,
overviews_refreshed}`. The status is `already_running` or `still_running` when
  another run holds the dream or the 45-minute wait ends first.

## Archive upload

`POST /archive` with `content-type: application/x-ndjson`. Each line:

```json
{
  "entry_id": "…",
  "conversation_id": "…",
  "speaker": "owner",
  "text": "…",
  "timestamp": "2026-11-26T09:00:00+00:00"
}
```

`speaker` is `owner` or `cos`; `timestamp` carries the client's local offset,
which decides the archive day. The whole body is validated before anything is
written. Replies: 200 with `{ok: true, data: {days: {<day>: {received, appended,
duplicates}}}}`; 400 with the first bad line; 403 for a non-loopback host or
origin; 413 above 8 MiB; 415 for another content type.
