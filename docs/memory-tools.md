# Memory tool reference

The isolated CoS recall agent has direct `memory_recall` and `memory_get` tools, without Code Mode or discovery. Main CoS and Worker have no conversational memory MCP tools. Manager has direct Code Mode MCP access through `project-memory`; capture and approved dream extensions retain programmatic access. Maintenance examples below apply to that connection or an explicitly authorized maintenance client. Calls use flat JSON arguments, not a nested `request`. Successful machine responses have `ok:true`, `data` and `warnings`; failures have `ok:false` and MCP `isError:true`. Recall/get also return readable evidence text with explained qualifications. Read actual results before claiming persistence; never overwrite unrelated records to resolve a conflict.

## Remember and recall

```json
{
  "content": "The owner prefers concise replies.",
  "projects": ["global"],
  "kind": "preference",
  "sources": [
    {
      "agent_id": "manager",
      "session_id": "<supporting session ID>",
      "entry_id": "<supporting entry ID>"
    }
  ],
  "memory_metadata": {
    "stage": "durable",
    "knowledge_type": "fact",
    "confidence": "confirmed",
    "status": "active"
  }
}
```

Pass this to `memory_remember` only when the source references, scope, and metadata are established; otherwise defer the addition. For Atlas's database choice, instead use `content:"Atlas uses SQLite rather than Postgres."`, `projects:["atlas"]` and `kind:"decision"`. A fact can belong to multiple evidenced projects from the catalog returned by `battuta-project list --json`; preserve registered spelling when selecting new labels. Use `["global"]` alone for genuinely non-project facts, never as an unknown-project fallback. The server returns lowercase memberships. Extra `tags` cannot use reserved `scope:`, `proj:` or `kind:` prefixes.

`memory_recall({"semantic_query":"previous database decisions and constraints","keywords":["SQLite","Postgres"]})` searches all projects and global memory. Either input can be omitted; at least one is required. Semantic-only uses embedding distance; keywords-only uses literal text/alias matching; both combine ranked results. Rewrite using conversation history, review results, and revise/repeat queries as useful. Keywords may be phrases, never raw query syntax. An oversized semantic query must be shortened or split, not silently truncated.

Use explicit `projects:["atlas"],include_global:false` for Atlas only or `selector:"global"` for global facts. There is no current-project recall selector or implicit selected-project restriction. Use `kind` to filter record kind and `tags` only for additional, non-reserved tags. Preserve the server-rendered confidence, provenance and counterevidence. Branch failure/omission is partial, not complete; unavailable is not empty memory. Explicit maintenance `include_expired:true` retrieves active expired history, not rejected/deleted records.

For source-backed writes, supply `sources` and `memory_metadata`; capture normally
builds these rather than asking the conversational model to reconstruct them.
Temporal means not dream-reviewed; durable means reviewed, not certain/permanent.
Keep fact, observation and hypothesis labels distinct. Never invent a source,
timezone, alias expansion or numerical confidence. Unknown attribution is deferred,
not confirmed. Exact-content retries with different scope/source/expiry conflict.

## Inspect, correct, and link

Use `memory_list({"selector":"all","page":1,"page_size":20})` for inventory; increment page until all `total` records are consumed. `memory_get({"ref":"<full returned content hash>"})` reads one complete record. `include_history:true` exposes predecessor/successor lineage, excluding deleted content from discovery.

After reading an incorrect record, call `memory_update({"ref":"<old ref>","content":"Atlas uses SQLite.","reason":"Owner corrected the database decision"})`. This creates a new version and returns a new ref. It inherits scope unless changed through the membership tool; default recall/list omit the predecessor. Existing-content collisions and stale refs are conflicts, not permission to overwrite unrelated history.

`memory_link_projects({"ref":"<ref>","add":["beacon"],"remove":[]})` adds evidence-backed membership without recomputing embeddings. New memberships must be in the catalog; an attached label may be removed after its project disappears. Removing the final project or attaching projects to a global record is rejected. Compatible exact-content retries reuse a record; conflicting membership needs an explicit evidenced link, not silent broadening.

`memory_set_metadata` takes `{ref,expected_revision,idempotency_key,memory_metadata,evidence}`
to change lifecycle/keywords without changing content or embedding. Read the full
record first, preserve confidence and sources, and use exact returned revisions.
The optional `replacement_ref` is for evidenced supersession after that replacement
was saved. Expiry filters current relevance; it does not delete historical evidence.
The [record contract](../memory-service/DESIGN.md#memory-record-contract)
defines fields and eligibility; do not improvise tags as substitutes.

## Forget and check health

Preview with `memory_forget({"ref":"<ref>","dry_run":true})`, then omit dry_run to tombstone exactly that ref. Upstream retains original content internally. This is neither secure erasure nor removal from transcripts, every historical version, or `ME.md`. No bulk deletion is exposed.

`memory_health({})` reports content-free backend/model readiness. If unavailable, report the failure rather than claiming no memories exist.

## Derived global relationships

`memory_global_relationships({})` reads up to 100 optional legacy global hints. Check `status`: stale/unavailable is not an empty memory store; `truncated:true` means edges were omitted. Read cited current records before interpreting an edge. Hints are not canonical evidence, authority or ordinary recall ranking, and v3 dreaming does not require them.

`memory_consolidate_global({"run_id":"2026-10-21T03:00:00Z"})` remains available for explicitly requested graph maintenance, not as a v3 dream requirement. Confirm its published generation; it does not change canonical facts, projects or the profile, and does not enable upstream compression/forgetting. Empty graphs can be valid; continued concurrent change returns a retryable failure.

## Background capture

`memory_capture` is normally called by the lifecycle adapter, not manually reconstructed by the agent. It classifies against the full prepared catalog, then uploads validated entries with frozen `projects`, source entry refs, batch/item IDs and payload digest. Project-invalid entries return for correction without blocking valid entries; unresolved work remains pending. Replays retain the original snapshot and do not recreate forgotten records. An empty extraction is valid. The model runs in the bot; the memory server embeds locally and never needs model-provider credentials.

Conversation tools do not directly edit the owner profile. When a request includes both “remember this” and “update ME.md”, perform the supported server-memory operation and report its confirmed result separately from profile maintenance. Never edit ME.md directly or claim its contents changed without confirmation from the dedicated dream workflow.

## Approved private dream

When an enabled, explicitly configured nightly dream requests it, call the CoS-only `memory_dream({})` tool once. It accepts no custom prompt or model. On `complete`, report that the tool ran successfully and convey its public `summary` of memory operations (including when no memory changes were needed); keep the report concise. This summary does not describe the later owner-profile refresh. For `partial`, `already_completed` (an older completed run without a public summary), cancellation, timeout, unavailability, or failure, report the actual status honestly without inventing a summary or claiming full success. Never request or repeat private reflections. Disabled or unconfigured dreams fail closed. A scheduler delivery marker does not prove the dream ran or the profile changed.
