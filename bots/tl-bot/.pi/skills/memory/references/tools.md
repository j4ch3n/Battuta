# TL read-only memory tool workflow

Discover the `memory` MCP server's read tools through native tool discovery: `memory_recall`, `memory_get`, `memory_list`, and `memory_health`. Use flat JSON arguments, not a nested `request`. Successful results have `ok:true`, `data`, and `warnings`; failures have `ok:false` and MCP `isError:true`. A tool failure is not an empty store: report unavailable context and do not invent results.

## Recall relevant scope

`memory_recall({"query":"database choice"})` defaults to current project plus global. For Atlas only, use `memory_recall({"query":"database choice","selector":"projects","projects":["atlas"],"include_global":false})`. Use `selector:"global"` for general context, or `selector:"all"` for explicitly cross-project recall. Kind/tag filters narrow selection; they do not broaden it. Without a current project, default selection returns labelled global-only results. Explicit project searches may read other projects.

## Inspect exact records and inventory

`memory_get({"ref":"<full returned content hash>"})` reads the complete record. Preserve the exact returned ref rather than guessing a prefix. `include_history:true` exposes predecessor/successor lineage; deleted content is excluded from discovery.

For inventory, use `memory_list({"selector":"projects","projects":["atlas"],"include_global":false,"page":1,"page_size":20})`; increment page until all `total` records are consumed. Default lists are active-only; `include_history:true` explicitly includes superseded records. Semantic recall is not exhaustive inventory.

`memory_health({})` reports content-free backend/model readiness.

## Route changes to PM

Example: read the outdated Atlas database record, then send PM its full reference, the owner's confirmed SQLite/offline correction, supporting source, and proposed Atlas-only scope. Ask PM to correct it; report “forwarded for correction” only after mail delivery succeeds. If delivery fails, report that blocker. Do not claim the memory changed until PM confirms the result.

TL must not call mutation or capture tools, even if discovery exposes them. Do not edit profiles or storage directly. Forgetting tombstones records, not securely erasing transcripts, every version, or profile content.
