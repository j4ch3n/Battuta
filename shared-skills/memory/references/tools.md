# Shared memory tool workflow

Discover the `memory` MCP server's tools through native tool discovery. Calls use flat JSON arguments, not a nested `request`. Successful responses have `ok:true`, `data` and `warnings`; failures have `ok:false` and MCP `isError:true`. Read those results before claiming a write succeeded.

## Remember and recall

```json
{
  "content": "The owner prefers concise replies.",
  "scope": { "global": true, "projects": [] },
  "kind": "preference"
}
```

Pass this to `memory_remember`. For Atlas's database choice, instead use `content:"Atlas uses SQLite rather than Postgres."`, `scope:{"global":false,"projects":["atlas"]}` and `kind:"decision"`. A fact can belong to multiple evidenced registered project slugs. Extra `tags` cannot use reserved `scope:`, `proj:` or `kind:` prefixes.

`memory_recall({"query":"database choice"})` searches current project plus global. Choose `selector:"projects",projects:["atlas"],include_global:false` for Atlas only; `selector:"global"` for general facts or `selector:"all"` for explicitly cross-project recall. Kind and additional tag filters narrow that selection; they never broaden it. No current selection produces labelled global-only results. Both bots may explicitly search any project.

## Inspect, correct, and link

Use `memory_list({"selector":"all","page":1,"page_size":20})` for inventory; increment page until all `total` records are consumed. `memory_get({"ref":"<full returned content hash>"})` reads one complete record. `include_history:true` exposes predecessor/successor lineage, excluding deleted content from discovery.

After reading an incorrect record, call `memory_update({"ref":"<old ref>","content":"Atlas uses SQLite.","reason":"Owner corrected the database decision"})`. This creates a new version and returns a new ref. It inherits scope unless changed through the membership tool; default recall/list omit the predecessor. Existing-content collisions and stale refs are conflicts, not permission to overwrite unrelated history.

`memory_link_projects({"ref":"<ref>","add":["beacon"],"remove":[]})` adds evidence-backed membership without recomputing embeddings. Removing the final project or attaching projects to a global record is rejected. Repeated exact-content remembers reuse or link a record; they never silently promote project facts to global.

## Forget and check health

Preview with `memory_forget({"ref":"<ref>","dry_run":true})`, then omit dry_run to tombstone exactly that ref. Upstream retains original content internally. This is neither secure erasure nor removal from transcripts, every historical version, or `ME.md`. No bulk deletion is exposed.

`memory_health({})` reports content-free backend/model readiness. If unavailable, report the failure rather than claiming no memories exist.

## Background capture

`memory_capture` is normally called by the lifecycle adapter, not manually reconstructed by the agent. It uploads validated extracted facts with frozen scope, source entry refs, batch/item IDs and payload digest. Replays resume partial batches without recreating forgotten records. An empty extraction is valid. The model runs in the bot; the memory server embeds locally and never needs model-provider credentials.

There are no profile-writing tools. When a request includes both “remember this” and “update ME.md”, perform the supported SQLite operation, report its result, and explicitly state that the read-only profile was not changed.
