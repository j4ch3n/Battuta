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
