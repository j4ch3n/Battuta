# PM memory tool workflow

Discover the `memory` MCP server's tools through native tool discovery. PM may read and mutate memories; TL's role is read-only even if the server exposes writes. Calls use flat JSON arguments, not a nested `request`. Successful responses have `ok:true`, `data` and `warnings`; failures have `ok:false` and MCP `isError:true`. Read those results before claiming a write succeeded. Report actual confirmed scope and returned references, warnings, and partial failures. Do not retry a conflict by overwriting unrelated records.

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

## Derived global relationships

`memory_global_relationships({})` reads up to 100 global relationship hints. Check `status`: only `current` results contain usable edges; `stale` or `unavailable` means no current graph, not an absence of remembered facts. `truncated:true` means more edges were omitted. Inferred connections and contradictions are heuristic hints: read the cited memories before interpreting them, and never treat an edge as permission to correct or forget a fact. Ordinary recall remains semantic, not graph-ranked.

`memory_consolidate_global({"run_id":"2026-10-21T03:00:00Z"})` is normally called by the approved dream worker after canonical cleanup. For an explicitly requested maintenance run, supply its timezone-aware ISO run identity and confirm the returned published generation. This derives global clusters/edges without changing facts, projects, the profile, or upstream graph rows. It does not enable upstream compression, forgetting, or automatic superseding. Empty graph results can be valid; continued concurrent changes return a retryable failure rather than a partially published graph.

## Background capture

`memory_capture` is normally called by the lifecycle adapter, not manually reconstructed by the agent. It uploads validated extracted facts with frozen scope, source entry refs, batch/item IDs and payload digest. Replays resume partial batches without recreating forgotten records. An empty extraction is valid. The model runs in the bot; the memory server embeds locally and never needs model-provider credentials.

Conversation tools do not directly edit the owner profile. When a request includes both “remember this” and “update ME.md”, perform the supported server-memory operation and report its confirmed result separately from profile maintenance. Never edit ME.md directly or claim its contents changed without confirmation from the dedicated dream workflow.

## Approved private dream

When an enabled, explicitly configured nightly dream requests it, call the PM-only `memory_dream({})` tool once. It accepts no custom prompt or model. On `complete`, report that the tool ran successfully and convey its public `summary` of memory operations (including when no memory changes were needed); keep the report concise. This summary does not describe the later owner-profile refresh. For `partial`, `already_completed` (an older completed run without a public summary), cancellation, timeout, unavailability, or failure, report the actual status honestly without inventing a summary or claiming full success. Never request or repeat private reflections. Disabled or unconfigured dreams fail closed. A scheduler delivery marker does not prove the dream ran or the profile changed.
