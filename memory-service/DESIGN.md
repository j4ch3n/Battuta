# Shared memory design

## Purpose and boundaries

Memory carries useful understanding across conversations: settled decisions, stable preferences, constraints, and concise project facts. It is **context, not execution authority or a replacement for canonical project documents**. Remembered statements may be stale, incomplete, or wrong; agents must check current evidence before acting.

The service is framework-independent. Battuta's Pi adapter is one client, not the owner of its storage or tool semantics. PM and TL share one server and database: PM reads/writes and TL reads under their runtime responsibilities. This trusted local service does not enforce per-agent authorization. Dream orchestration and profile generation belong to the PM client; dashboards, historical import and remote hosting/authentication remain excluded.

## Memory layers

These are conceptual layers with different responsibilities, **not implemented storage tiers or automatic promotion levels**:

| Layer                | Purpose                                                        | Ownership and lifetime                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working conversation | Current request, recent exchanges, immediate reasoning context | Managed by the agent runtime. Persisted session history is evidence for extraction, not a memory-server transcript archive.                                                 |
| Durable fact memory  | Small, reusable facts retrieved across sessions                | Shared SQLite records exposed through MCP. Each has scope, kind, tags, and optional source references. Corrections create versions; explicit forgetting tombstones records. |
| Owner profile        | High-level understanding of the human owner                    | Shared private `ME.md`, loaded by PM and replaced as a whole by the dream worker using cited personal evidence. TL does not preload it.                                     |

Canonical specifications, checklists, reviews, and project documents sit alongside these layers, not above them as another memory database. Use the project-context workflow for authoritative artifacts. A memory about an approval is not the approval itself.

Global and project memory are **scopes within the same durable-fact layer**. They do not have separate databases, retention levels, permissions, or priority ranks. A broadly relevant fact is not automatically more reliable than a project-specific one.

## Scope design

### Explicit membership

Each record is either:

- **Global:** applicable beyond a particular project, represented by `scope:global`.
- **Project-scoped:** belongs to one or more registered project slugs, represented by `proj:<slug>` tags.

Scope must not be empty or mix global with project membership. Project identities come from the shared registry, not repository paths, branch names, session IDs, or agent roles. Explicit project selections and membership changes validate registrations; corrupt registrations are errors rather than permission to search everything.

Examples of `memory_remember` arguments:

```json
{
  "content": "The owner prefers concise replies.",
  "scope": { "global": true, "projects": [] },
  "kind": "preference"
}
```

```json
{
  "content": "Atlas uses SQLite rather than Postgres.",
  "scope": { "global": false, "projects": ["atlas"] },
  "kind": "decision",
  "tags": ["database"]
}
```

A fact evidenced to apply to Atlas and Beacon can have `projects:["atlas","beacon"]`. Multi-project membership does not make it global. Adding membership requires evidence of applicability, not merely similar wording or a nearby semantic-search result.

### Relevance, not authorization

Both bots may explicitly inspect any project or all memories. The selected project supplies a useful default, not an access boundary. `agent_id` identifies a source; it does not create a private PM/TL namespace. V1 relies on a trusted local, same-user deployment rather than per-agent access control.

Recall and inventory use these selectors:

| Selector            | Eligible scope                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `current` (default) | Selected project plus global by default; a missing selection produces a global-only warning. |
| `projects`          | Union of the named registered projects, optionally including global.                         |
| `global`            | Global records only.                                                                         |
| `all`               | Every scope, explicitly requested.                                                           |

`include_global:false` narrows a project selection. A multi-project record matching several selected projects is still returned once. Kind and extra-tag filters narrow the selected set with AND; `tag_match` controls all/any matching only within the extra tags. They never broaden scope. Reading an exact ref is not restricted by the current selection.

### Scope, kind, and tags are independent

- **Scope** answers where a fact is relevant.
- **Kind** describes its meaning, such as `decision`, `preference`, or `observation`; it is not a reliability or memory-level score.
- **Extra tags** support topic filtering, such as `database`.

The wrapper owns `scope:`, `proj:`, and `kind:` metadata. Callers cannot supply those prefixes as extra tags or include commas, which would manufacture extra tags in upstream's CSV representation. Wrapper kinds remain intact in `kind:` tags even when upstream maps their underlying storage type to `observation`.

## Components and data ownership

```text
Persisted bot conversation
  → Pi adapter: redact, accumulate, extract with the bot's configured model
  → durable capture queue: validated facts, frozen scope, source IDs
  → shared MCP service: validate, journal, apply, receipt
  → upstream storage: SQLite + sqlite-vec + local ONNX embeddings

Any other MCP client → the same shared tools and storage
```

| Component                              | Responsibility                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `memory-client/`                       | Pi lifecycle hooks, existing PM profile loading, bounded conversation extraction, private queue, MCP upload. |
| `contracts.py`, `scope.py`             | Public request validation, registry resolution, and relevance selection.                                     |
| `service.py`, `capture.py`, `state.py` | Memory workflows, serialized mutations, durable intent/receipt state, capture deduplication.                 |
| `upstream.py`                          | The pinned boundary to mcp-memory-service 12.1.1 storage, embeddings, and existing schema.                   |
| `model_setup.py`                       | Explicit model provisioning, archive/file verification, and model identity.                                  |
| `server.py`                            | Tailored tools over loopback Streamable HTTP; no upstream server/dashboard is exposed.                       |

One process owns the shared data directory. Upstream owns `memory.db`; Battuta owns `state.db` for recovery and receipts. These are **not a single transaction**. Per-role capture queues are delivery state, not separate memory stores. No per-project database or `MEMORY.md` is created, and no upstream source/schema is forked or patched.

## Capture: conversation to durable facts

1. Freeze the registered project at request start. Later selection changes must not relabel that request's conversation.
2. Collect new persisted user/assistant text and labelled incoming inter-bot mail. Exclude reasoning, system/profile content, raw tool results, and attachments. Redact supported credential forms before queue persistence or model input.
3. Persist the accumulator and seen entry IDs at settlement, even below the default six-message threshold. First-seen resumed history is not backfilled. Session boundaries flush smaller batches.
4. Use the bot's existing model/provider to extract concise facts from bounded segments. Conversation text is untrusted data, not extraction instructions. Validate source IDs, scope, tags, and credentials again before upload. No useful facts is a valid empty result.
5. Persist the validated batch before sending it through MCP. Source refs identify agent, session, and persisted entry. Batch/item identity and a canonical payload digest make retries distinguishable from conflicting requests.
6. Acknowledge only confirmed complete batches. Retain incomplete work with bounded retry/backoff; a transport retry reuses the extracted batch rather than calling the LLM again. A token-limit rejection permits one rephrase under a distinct identity, not unbounded paid retries.

Automatic capture is enabled for PM and disabled for TL by default. It is best-effort understanding, not a guarantee that every fact is remembered correctly. PM uses tools directly for important explicit corrections; TL forwards findings to PM. Capture failure must not prevent normal conversation. The server itself receives extracted facts, not a continuous transcript feed, and needs no model-provider credential.

## Retrieval and embeddings

The server embeds content locally using ONNX all-MiniLM-L6-v2: 384 dimensions, CPUExecutionProvider, the same model/preprocessing for storage and query. Scope is metadata, not text injected into the embedding. Token counting checks the untruncated input; inputs exceeding 256 tokenizer tokens are rejected rather than silently shortened.

Provisioning is explicit and separate from startup. Weights and tokenizer are checksum verified, fingerprinted, and bound to the data directory. Readiness requires an actual loaded ONNX model/tokenizer/provider and a finite probe vector, even for an empty store. Missing, corrupt, or changed models fail closed; hash pseudo-vectors and runtime model downloads are not acceptable fallbacks. Model replacement needs an explicit re-embedding migration; V1 does not implement one.

Recall filters scope/state before exact sqlite-vec distance ranking, so unrelated nearest neighbours cannot exhaust a global candidate limit and hide a scoped fact. This costs linear distance work within the eligible corpus; V1 favors complete, predictable scope behavior over premature indexing complexity. Inventory is paginated and not semantic; use it rather than recall to enumerate records. There is no automatic recall-to-system-prompt injection.

Ordinary browsing uses paginated `memory_list`. Dream uses `memory_inventory`: one serialized, bounded all-scope snapshot with active records, inactive references/replacement lineage, recent-change refs and explicit half-open window bounds. Older active facts remain available as comparison context. A record revision covers content, membership and state, so client evidence and target preconditions can reject stale mutations. An oversized snapshot fails rather than paginating a changing corpus or truncating relevant evidence.

## Identity, correction, and forgetting

Content refs are upstream hashes of normalized text (trimmed and lowercased), not scope-specific IDs. Consequently:

- Exact text retries reuse identity. An evidenced project match can union membership and sources without another copy of the fact.
- Similar but nonidentical facts remain separate; semantic deduplication/merging is disabled.
- An exact global/project collision is a conflict, not implicit promotion or a second scope-specific copy.
- `memory_update` creates a new ref with predecessor/successor lineage. Stale predecessors and existing-content collisions cannot be silently overwritten.
- `memory_link_projects` changes membership without regenerating vectors; it cannot remove the final project or attach project membership to a global fact.
- Default recall/list/get omit superseded versions. Explicit history includes retained predecessors, not deleted content.
- `memory_forget` tombstones exactly one ref. It does not erase every version, transcript, profile, backup, or queue.

Mutations journal intent before upstream changes, then store a receipt. Startup reconciles pending work before new mutations. Completed receipts preserve the original outcome even if the record was later forgotten; retries must not resurrect it. Recovery can repair the exact journal-owned orphan left by a crash during version linking. If upstream instead compensates by tombstoning the replacement, record a terminal failure and keep unrelated writes/startup usable—do not revive the failed target.

Forgetting is **not secure erasure**. Tombstones retain upstream content; completed journal payloads are logically cleared, but old SQLite/WAL pages, transcripts, queues, dream checkpoints, logs, profiles and backups may still contain text. Dream may automatically retire obsolete or merged facts; no hard-erasure promise or TTL-based memory-level policy exists.

Mutation receipts may retain before/after fact content so replay can distinguish a new write from a reused record or a historical acknowledgement whose record is now inactive. Clearing the intent payload does not erase these acknowledged outcomes.

## PM dream orchestration

The PM client uses the existing prompt scheduler for a daily isolated session. Its dedicated tool takes a bounded inventory, partitions exact scopes, asks the configured model for cited mutations, validates the whole plan and applies server operations under revision preconditions. It refreshes the complete canonical personal profile from global evidence, then obtains an LLM reflection grounded in confirmed changes. The service does not run a separate consolidation scheduler or accept model-authored arbitrary commands.

The client persists its immutable plan, acknowledgements, profile evidence and reflection in private atomic files under the shared data directory. A crash-released run lock prevents concurrent workers; replay resumes confirmed work rather than recomputing proposals. Log publication is idempotent by scheduled run identity. Failed or partial work is not described as fully applied. These files and server databases are not a single transaction; each boundary has its own recovery checks.

## Deliberately deferred

Upstream automatic semantic merging, confidence/importance-based tiers, automatic global promotion, historical Stone import, multilingual-model adoption, model migration tooling, remote authentication, dashboards and per-agent permission boundaries are not implemented. Dream uses Battuta's validated server APIs rather than enabling upstream's direct-storage consolidation engine.

For operational configuration, recovery, and cutover, see [memory operations](../docs/memory-service.md). For invocation examples and user-visible tool behavior, see [tool workflow](../shared-skills/memory/references/tools.md).
