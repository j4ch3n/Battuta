# Memory tool reference

The CoS memory client calls `memory_recall` and `memory_get` directly from the host, without a model or Code Mode. Main CoS and Worker have no conversational memory MCP tools. Manager has direct Code Mode MCP access through `project-memory`; capture and approved dream extensions retain programmatic access. Maintenance examples below apply to that connection or an explicitly authorized maintenance client. Calls use flat JSON arguments, not a nested `request`. Successful machine responses have `ok:true`, `data` and `warnings`; failures have `ok:false` and MCP `isError:true`. Recall/get also return readable evidence text with explained qualifications. Read actual results before claiming persistence; never overwrite unrelated records to resolve a conflict.

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
    "knowledge_type": "fact",
    "confidence": "confirmed"
  }
}
```

Pass this to `memory_remember` only when the source references, scope, and metadata are established; otherwise defer the addition. For Atlas's database choice, instead use `content:"Atlas uses SQLite rather than Postgres."`, `projects:["atlas"]` and `kind:"decision"`. A fact can belong to multiple evidenced projects from the catalog returned by `battuta-project list --json`; preserve registered spelling when selecting new labels. `global` is an ordinary project for the owner's personal facts; it can be combined with other projects, never used as an unknown-project fallback. The server returns lowercase memberships. Extra `tags` cannot use reserved `scope:`, `proj:` or `kind:` prefixes.

`memory_recall({"semantic_query":"previous database decisions and constraints","keywords":["SQLite","Postgres"]})` searches all projects and global memory. Either input can be omitted; at least one is required. Semantic-only uses embedding distance; keywords-only uses literal text/alias matching; both combine ranked results. Rewrite using conversation history, review results, and revise/repeat queries as useful. Keywords may be phrases, never raw query syntax. `semantic_queries` accepts a list of recent request texts, newest first: when their combined text fits the embedding limit it is searched once; otherwise each text is searched separately, each truncated to the limit, and the results are merged by rank (each search's top result first, no repeats). A single `semantic_query` is handled the same way.

Use explicit `projects:["atlas"],include_global:false` for Atlas only or `selector:"global"` for global facts. There is no current-project recall selector or implicit selected-project restriction. Use `kind` to filter record kind and `tags` only for additional, non-reserved tags. Preserve the server-rendered confidence, provenance and counterevidence. Branch failure/omission is partial, not complete; unavailable is not empty memory. Explicit maintenance `include_expired:true` retrieves active expired history, not rejected/deleted records.

For source-backed writes, supply `sources` and `memory_metadata`; capture normally
builds these rather than asking the conversational model to reconstruct them.
`knowledge_type` is `fact` or `inference`; an inference needs a rationale and supporting evidence and is never `confirmed`.
Keep fact and inference labels distinct. Never invent a source,
timezone, alias expansion or numerical confidence. Unknown attribution is deferred,
not confirmed. Exact-content retries with different scope/source/expiry conflict.

## Inspect, correct, and link

Use `memory_list({"selector":"all","page":1,"page_size":20})` for inventory; increment page until all `total` records are consumed. `memory_get({"ref":"<full returned content hash>"})` reads one complete record. `include_history:true` exposes predecessor/successor lineage, excluding deleted content from discovery.

After reading an incorrect record, call `memory_update({"ref":"<old ref>","expected_revision":"<returned revision>","content":"Atlas uses SQLite.","reason":"Owner corrected the database decision","sources":[{"agent_id":"manager","session_id":"<supporting session ID>","entry_id":"<supporting entry ID>"}],"memory_metadata":{"knowledge_type":"fact","confidence":"confirmed"}})`. This creates a new version and returns a new ref. It inherits scope unless changed through the membership tool; default recall/list omit the predecessor. Existing-content collisions and stale refs are conflicts, not permission to overwrite unrelated history. Defer the correction when its new source or metadata cannot be established.

`memory_link_projects({"ref":"<ref>","add":["beacon"],"remove":[]})` adds evidence-backed membership without recomputing embeddings. New memberships must be in the catalog; an attached label may be removed after its project disappears. Removing the final project is rejected. Compatible exact-content retries reuse a record; conflicting membership needs an explicit evidenced link, not silent broadening.

Expiry filters current relevance; the dream deletes expired records. The [record contract](../memory-service/DESIGN.md#memory-record-contract)
defines fields and eligibility; do not improvise tags as substitutes.

## Forget and check health

Preview with `memory_forget({"ref":"<ref>","dry_run":true})`, then omit dry_run to soft-delete exactly that ref; deleted records disappear from recall, listing and dreaming. Upstream retains original content internally. This is neither secure erasure nor removal from transcripts, every historical version, or `ME.md`. No bulk deletion is exposed.

`memory_health({})` reports content-free backend/model readiness. If unavailable, report the failure rather than claiming no memories exist.

## Derived global relationships

`memory_global_relationships({})` reads up to 100 optional legacy global hints. Check `status`: stale/unavailable is not an empty memory store; `truncated:true` means edges were omitted. Read cited current records before interpreting an edge. Hints are not canonical evidence, authority or ordinary recall ranking, and v3 dreaming does not require them.

`memory_consolidate_global({"run_id":"2026-10-21T03:00:00Z"})` remains available for explicitly requested graph maintenance, not as a v3 dream requirement. Confirm its published generation; it does not change canonical facts, projects or the profile, and does not enable upstream compression/forgetting. Empty graphs can be valid; continued concurrent change returns a retryable failure.

## Background capture

`memory_capture` is normally called by the lifecycle adapter, not manually reconstructed by the agent. It classifies against the full prepared catalog, then uploads validated entries with frozen `projects`, source entry refs, batch/item IDs and payload digest. Project-invalid entries return for correction without blocking valid entries; unresolved work remains pending. Replays retain the original snapshot and do not recreate forgotten records. An empty extraction is valid. The model runs in the bot; the memory server embeds locally and never needs model-provider credentials.

Conversation tools do not directly edit the owner profile. When a request includes both “remember this” and “update ME.md”, perform the supported server-memory operation and report its confirmed result separately from profile maintenance. Never edit ME.md directly or claim its contents changed without confirmation from the dedicated dream workflow.

## Approved private dream

The dream deletes expired records, then groups active records per project by embedding
similarity (`memory_cluster`; groups are split to at most 30 records, singletons are skipped).
Each group that contains a new or changed record is edited by one model call that keeps,
removes or replaces memories; new facts are inserted before the replaced records are
soft-deleted. One further call proposes tentative inferences across all group summaries,
each linked as supporting evidence to the records it cites. Failed groups end the run as
`partial` while the others complete.

Failed dream calls return `isError:true` and structured details with `status` and
`error` (`stage`, `code`, sanitized `message`, optional `retryable`/`paths`).
Use those details to explain the failure rather than invent a cause. Model-facing diagnostics never include provider error text; the raw error (truncated to 800 characters) is
in the private `dream-errors.jsonl`, which agents must not read unless the owner asks for the reason.
Private memory text and reflections are not error diagnostics.

When an enabled, explicitly configured nightly dream requests it, call the CoS-only `memory_dream({})` tool once. It accepts no custom prompt or model. On `complete`, report that the tool ran successfully and convey its public `summary` of memory operations (including when no memory changes were needed); keep the report concise. This summary does not describe the later owner-profile refresh. For `partial`, `already_completed` (an older completed run without a public summary), cancellation, timeout, unavailability, or failure, report the actual status honestly without inventing a summary or claiming full success. Never request or repeat private reflections. Disabled or unconfigured dreams fail closed. A scheduler delivery marker does not prove the dream ran or the profile changed.
