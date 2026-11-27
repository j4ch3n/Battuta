# Memory tool reference

Every tool returns `{ok: true, data}` or
`{ok: false, error: {code: invalid_request | backend_unavailable, message}}`.
Errors never include internal paths or raw exceptions.

## Read tools (`/mcp` and `/mcp/read`)

| Tool                          | Description                                                                                                                                                                                | Arguments                                                                  | `data`                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `memory_recall`               | `projects` alone returns each project's overview; with `query` it searches those projects, optionally narrowed by `types`; `query` alone searches everything. `limit` is 1–30, default 10. | `projects?: string[]`, `types?: string[]`, `query?: string`, `limit?: int` | `{status: "ok", memories: [{name, type, project, abstract, body, updated}]}` or `{status: "invalid", projects, types}`       |
| `memory_types`                | Lists memory types and when each is written, for choosing recall `types`.                                                                                                                  | none                                                                       | `{types: [{type, description}]}` (overview excluded)                                                                         |
| `memory_project_overview`     | Reads one project's overview.                                                                                                                                                              | `project: string`                                                          | `{status: "ok", overview: {abstract, body, created}}`, `{status: "not_written"}`, or `{status: "unknown_project", projects}` |
| `memory_project_descriptions` | One-line descriptions of the requested (or all) projects; `null` when no overview exists yet.                                                                                              | `projects?: string[]`                                                      | `{descriptions: {<project>: abstract or null}}`                                                                              |

`global` is a valid project for the owner's personal memories. Project names
match the `battuta-project` catalog, ignoring case and spacing.

## CoS tools (`/mcp` only)

| Tool                  | Description                                                                                                                                                                                                                                                                                                                                                                                                     | Arguments                                                       | `data`                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `memory_profile`      | Reads the owner card (the global overview).                                                                                                                                                                                                                                                                                                                                                                     | none                                                            | `{status: "ok", body}` or `{status: "not_written"}`                                                               |
| `memory_dream_start`  | Starts the nightly dream in the background, after the conversation is uploaded.                                                                                                                                                                                                                                                                                                                                 | none                                                            | `{status: "started"}` or `{status: "already_running"}`                                                            |
| `memory_dream_status` | Reports the current or last dream run.                                                                                                                                                                                                                                                                                                                                                                          | none                                                            | `{status: idle \| running \| succeeded \| failed, step, started_at, finished_at, last_success_at, error, report}` |
| `memory_health`       | Checks that the store is ready.                                                                                                                                                                                                                                                                                                                                                                                 | none                                                            | `{ready, projects}` (catalog size)                                                                                |
| `memory_forget`       | Only on the owner's confirmation or instruction. Marks memories obsolete: recall stops returning them, historical reads still find them, files are kept, and there is no undo. An entry without `successor` is `forgotten`; with one, it is `superseded` by that active memory; an already-invalid entry is a `no-op`. Up to 25 entries per call is recommended; larger calls still run and return a `warning`. | `entries: [{slug, successor?}]`, `reason`, `owner_confirmation` | `{results: [{slug, result: forgotten \| superseded \| no-op, invalid_at, successor?}], message, warning?}`        |

`memory_forget` validates the whole call before writing and returns
`invalid_request` with no writes for malformed or blank arguments, repeated
slugs, a successor that is its own slug or also being forgotten, unknown slugs
(all listed), a missing or invalid successor, or a running dream. A write that
fails part-way returns `invalid_request` naming the entries already applied.
Each change appends `forget:<slug>` (`accepted`, with `action`, `invalid_at`,
`successor`, `reason`, `owner_confirmation`, `by: "cos"`) to
`dream-reports/decisions.md`; if that line cannot be written, the call stops
and adds `audit_missing`, `applied`, `not_processed` and `error` to the reply,
with the change still applied.

## CoS Pi tools

The CoS memory client registers these for CoS's model:

- `memory_recall {projects?, types?, query?}` and `memory_types`: the read tools above.
- `memory_dream`: extract and upload the conversation, start the dream, wait for
  it, and return `{status, step, error, uploaded, memories_written, consolidation,
overviews_refreshed}`. The status is `already_running` or `still_running` when
  another run holds the dream or the 45-minute wait ends first.

CoS's MCP entry adds `memory_forget`, `memory_project_overview` and
`memory_project_descriptions` from the tables above.

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
