# Shared memory architecture and operations

The [component design](../memory-service/DESIGN.md) explains memory layers, scope versus kind, data ownership, capture, retrieval, and lifecycle invariants. This reference covers configuration and operations.

| Component         | Responsibility                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `memory-service/` | Tailored MCP tools over loopback Streamable HTTP: `/mcp`, default port `8901`.                                                    |
| Upstream adapter  | Composes mcp-memory-service **12.1.1** storage, embeddings, and read-only graph analysis; no upstream source is copied or forked. |
| `memory-client/`  | Thin Pi lifecycle integration, not another memory database.                                                                       |
| Other MCP clients | Can use the shared server independently of Pi.                                                                                    |

## Persistence and scope

### Storage

| Item                  | Location or behavior                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| Shared data directory | `~/.battuta/memory/`; override with `BATTUTA_MEMORY_DATA_DIR`.                          |
| `memory.db`           | Upstream-owned memory records and embeddings.                                           |
| `state.db`            | Application-owned mutation journal, receipts, and derived global graph generations.     |
| Service lock          | Allows one server to own the data directory.                                            |
| `capture-queue/`      | Private per-role delivery state.                                                        |
| Model weights         | Remain under the service user's HOME cache, independent of the data-directory override. |

- Run bots and server under the **same user**.
- Protect data directories and backups as private conversation data.
- There is no `MEMORY.md` or per-project memory database.

### Scope and record behavior

| Concern                                    | Rule                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Global facts                               | Use `scope:global`.                                                                                                  |
| Project facts                              | Use `proj:<registered-name>`; a record may belong to multiple projects.                                              |
| PM/TL responsibilities                     | PM reads/writes; TL reads and forwards durable findings to PM. The local server is not a per-role security boundary. |
| Default recall                             | Current project plus global; explicit global/projects/all selectors are available.                                   |
| Additional filters                         | AND with scope; registry errors never silently broaden the search.                                                   |
| Exact duplicates                           | Reuse content identity and can attach evidenced project membership.                                                  |
| Semantic near-duplicates                   | Remain distinct until an evidence-backed PM correction or dream merge.                                               |
| Global/project collisions or inactive refs | Conflict rather than implicitly broaden scope.                                                                       |
| Content corrections                        | Create a new hash/version.                                                                                           |
| Membership changes                         | Reuse the stored embedding.                                                                                          |
| Superseded records                         | Omitted by default from recall/list/get.                                                                             |
| Forgetting                                 | Tombstones one ref and retains upstream content; **not secure erasure**.                                             |
| Wrapper kinds                              | Preserved in owned `kind:` tags, including `preference`, independently of upstream's narrower type ontology.         |
| User-supplied tags                         | Cannot contain commas or reserved prefixes that could manufacture scope/kind metadata through CSV serialization.     |

### Retrieval, recovery, and backups

- **Retrieval:** Serialized, read-only queries against the pinned schema propagate inventory errors and rank exact filtered sqlite-vec distances. This avoids global candidate-limit omissions at the cost of linear work within the selected corpus.
- **Upgrades:** Rerun adapter contract tests before changing the upstream dependency.
- **Write recovery:** Journal intent in `state.db` before upstream writes, then record receipts. The two databases are **not one transaction**; restart reconciles pending intents before new operations.
- **Replay safety:** Completed receipts prevent retries from recreating later-forgotten content. Narrow journal-owned lineage repair handles crashes inside upstream's multi-commit version update.
- **Failed corrections:** If upstream tombstones a replacement to compensate for failure, record a terminal failure rather than revive the target or block unrelated writes. The original stays unchanged; retry with current evidence and revised content.
- **Retention:** Pending intents contain requested content until completed. Completion clears the logical intent payload, but receipts can retain actual before/after fact text for accurate replay; SQLite/WAL pages and backups may also retain content. No hard-erasure promise is made.
- **Backups:** Back up both databases consistently with the server stopped or via SQLite backup, together with any pending capture queue you want to retain.

## Embeddings

| Setting or invariant | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Model                | Local MiniLM `all-MiniLM-L6-v2`.                                                               |
| Runtime/provider     | ONNX Runtime `CPUExecutionProvider`.                                                           |
| Vector dimensions    | `384`.                                                                                         |
| Embedded input       | Memory content, not project tags; queries use identical model/preprocessing.                   |
| Integrity            | Weights/tokenizer are checksum verified and fingerprint-bound to the data directory.           |
| Readiness            | Missing, corrupt, or changed models and hash fallback fail readiness—even on a fresh database. |
| Input limit          | More than `256` tokenizer tokens is rejected, never silently truncated.                        |
| Model changes        | Require an explicit migration/re-embedding workflow; V1 does not supply one.                   |

- The server needs **no model-provider credential**.
- The service exposes no dashboard, graph UI, historical bootstrap or remote binding. Dream orchestration belongs to the PM client, not the server.

## Conversation capture

### Collection and extraction

This pipeline runs only when capture is enabled: PM by default, not TL.

| Stage      | Behavior                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collect    | Both bots collect new persisted user/assistant text and labelled incoming agent mail.                                                                                               |
| Exclude    | System/profile content, thinking, attachments, and raw tool results. First-seen resumed history is not backfilled.                                                                  |
| Persist    | Atomically save redacted messages and source cursor at settlement, even below the extraction threshold.                                                                             |
| Bind scope | Keep the request-start project binding with its segment.                                                                                                                            |
| Flush      | Session switch/fork/compaction/shutdown flush smaller batches for later processing.                                                                                                 |
| Extract    | Use the bot's configured model/provider—not a new server-side LLM—to produce up to `20` concise cited facts per bounded segment.                                                    |
| Validate   | Check output schemas, source IDs, scope, and credentials before upload.                                                                                                             |
| Queue      | Persist the validated extracted batch before its first MCP call.                                                                                                                    |
| Retry      | Network retries reuse that batch without another model call. A token-limit rejection permits one rephrase under a distinct batch identity, then retains failed work for inspection. |
| Bound work | Attempt at most two jobs per boundary, with exponential backoff from one second to one minute. Cancellation is not success.                                                         |
| Report     | Failures produce content-free statuses without stopping normal conversation. Record extraction usage in a `memory-capture-usage` session entry.                                     |

### Settings and queue handling

Bot `.pi/settings.json` accepts:

```json
{
  "battutaMemoryCapture": { "enabled": true, "batchMessages": 6 }
}
```

- `batchMessages` defaults to **6**, with an allowed range of **1–100**.
- `enabled` controls automatic collection, extraction, and uploads, including retries of queued work. It defaults to **true for PM**, **false for TL**; an explicit boolean overrides the client default. Memory reads are unaffected. Disabled capture leaves existing queue files untouched.
- Source and release setup configure TL capture as **disabled**, including previously enabled TL configurations; PM's explicit setting is preserved. Setup does not delete queues.
- Settings load when the adapter initializes; restart after changes.
- Queues retain private source text until acknowledged. Inspect stuck queues locally; do not paste them into chat or indiscriminately delete them.
- Capture is best-effort understanding, not guaranteed preservation of every conversation fact.

## Owner profile and nightly dream

| Concern                   | Behavior                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| PM                        | Loads `<memory-data-dir>/ME.md` before a request, up to `32,000` bytes.                               |
| TL                        | Does not load the profile.                                                                            |
| Missing file              | Normal; no profile is required.                                                                       |
| Unreadable/oversized file | Warn without failing the bot.                                                                         |
| Profile writes            | Dream replaces the complete canonical document; ordinary memory writes do not immediately rewrite it. |
| Legacy private profile    | Existing bot `.pi/ME.md` is neither loaded nor migrated automatically.                                |

### Workflow and limits

- The PM's existing prompt scheduler triggers one isolated dream session at **03:00**, using `0 0 3 * * *`, an explicit provider/model, workdir scope and `notify:false`. It runs only while PM is running. The process's local timezone determines 03:00; set the same `TZ` for PM processes if a specific zone is required.
- Pi owns the scheduler and daily orchestration. The memory client supplies `memory_dream` and its deterministic worker, not another scheduler. Its pinned scheduler **development dependency** is used only by offline compatibility tests and is excluded from production client installs.
- A frozen rolling **72-hour** window identifies facts to revisit. A bounded all-scope inventory supplies older active context and inactive references. The default limit is **500 stored records** (including inactive records); excess inventory or model-input budgets fail explicitly rather than silently truncate evidence. Three days is a change window, not a replacement for accumulated understanding.
- A model proposes scoped inserts, versioned updates and forgetting. Deterministic validation checks the whole plan before writes. Server mutations use revision preconditions and journaled receipts; a merge saves its replacement before retiring redundant sources. Project `SUMMARY.md` and canonical documents are not dream outputs.
- After cleanup, the server uses upstream clustering and association/relationship analysis on **all surviving active global memories**, not projects or just the recent window. Results are derived graph generations in `state.db`, not extra memory facts or upstream graph rows. No automatic upstream compression, forgetting, decay writes, or superseding runs. The server needs no LLM credential for this stage.
- A generation is published only against matching canonical refs/revisions and analysis/model settings. Analysis does not hold the canonical mutation lock; if global evidence changes, at most two analysis attempts are made before a retryable failure. Small corpora can produce a valid empty graph. Global changes invalidate old hints; edges are not blindly migrated to corrected or merged memories.
- Future cleanup planning may use up to 100 current relationship hints, checked against its global inventory. Inferred relationships are heuristic context, not canonical evidence or execution authority. Stale/unavailable hints are omitted. Ordinary recall ranking stays unchanged.
- A separate model call refreshes the entire owner profile using active global personal evidence, preserving canonical headings and supported existing understanding. Evidence references live outside `ME.md`. Project facts are not owner traits, and profile content never grants execution authority.
- After confirmed changes, a separate bounded model call writes a meaningful reflection to `dream.log`: one timestamped line, **at most 149 words including timestamp and separator**. The log is private prose, not a raw-entry dump, transcript, generic operation count, or new memory input. One invalid-output rewrite is allowed; provider or publication failure is not reported as success.
- A cross-process SQLite run lock releases on process exit. Private atomic checkpoints preserve the validated plan, acknowledgements, profile draft and reflection for replay without repeating confirmed writes or paid synthesis. A startup catch-up uses the same worker and run identity, not one run per missed day and not a second daily timer.

`notify:false` prevents the scheduler from triggering a follow-up turn; it does **not** make the job invisible. The pinned scheduler still posts custom start/result/error markers, including a result snippet, in PM's session. These markers are excluded from automatic memory capture. Do not treat the PM session or its logs as public output.

The child exposes only `memory_dream`, with no active shell/file/MCP tools or ordinary capture hooks. This is tool isolation, **not a security sandbox**: the pinned loader filters extensions after importing/initializing them and inherits AGENTS context. Install only trusted PM extensions. For scheduler children, model/auth must be available from the persisted Pi agent directory; parent-only runtime registrations are not inherited by this pinned scheduler/Pi combination.

### Recovery and retained private files

The shared memory directory also contains `dream-lock.db`, `dream-state.json`, `dream-profile.json`, `ME.md` and `dream.log`. Treat all of these and capture queues as private data; checkpoint files can contain before/after fact text. They are separate from the server's database transactions. Numeric model usage/cost fields are recorded separately in `dream-usage.jsonl` because isolated child sessions have no durable session journal; this file contains no prompt or generated text and has no automatic rotation.

- Transient service/provider failures leave a pending checkpoint for retry. Never delete it merely to retry: an operation may have succeeded before its acknowledgement was lost.
- Graph failure occurs before new profile publication and leaves the run incomplete. Retry resumes acknowledged canonical work and reuses matching graph drafts/generations rather than resampling after a lost acknowledgement. Current code reads version-1 checkpoints and writes version 2 without replaying confirmed mutations or discarding already published artifacts; completed same-day legacy runs stay completed.
- A terminal mutation conflict stops dependent cleanup, preserves source facts, and records only confirmed changes as an explicitly partial reflection. Unapplied changes remain eligible for reconsideration on a later run.
- An edited owner profile or invalidated source during publication must not be overwritten by a stale draft. Recovery re-synthesizes against current evidence without repeating acknowledged mutations. Inspect persistent failures locally, without pasting private checkpoint content into chat.
- Log publication is reconciled by run identity. A retry after publication must not append a second reflection for that run.
- Back up dream files and queues together with consistent database backups. Forgetting a server record does not securely erase profile text, checkpoints, logs or backups.

## Breaking replacement and cutover

### Retirement guarantees

- Stone is retired, **not backward compatible**.
- No old tool aliases, settings translators, dual reads/writes, legacy database loading, or automatic import remain.
- Setup removes obsolete owned package/extension/settings entries without interpreting their semantics.
- Existing private profiles are preserved. Setup performs no historical-data migration or cleanup.

### Controlled cutover

1. Obtain approval before stopping existing bots.
2. Record existing data/profile paths and take consistent backups. **Do not naively copy a live SQLite WAL database.**
3. Provision the new server separately and configure both native MCP entries.
4. Restart bots with the new adapter; do not start duplicate bot processes.
5. Verify `memory_health`, PM scoped writes/recall, TL read-only recall and disabled capture, and a PM capture batch.
6. Confirm PM-only preload with temporary sentinel fixtures, never by exposing real profile text.

The isolated exploration server on port **8900** is unrelated and must not be killed.

### Rollback

- Stop the new bots/service and preserve the new data.
- Restore the previous release/configuration and its consistent pre-cutover backup.
- Do not downgrade either SQLite schema or point the old release at the new database.
- This is an operator-controlled restore, not compatibility inside the new system.

## Verification

| Check                    | Coverage                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| `pnpm check:support`     | Offline Python unit and adapter-contract tests.                       |
| `pnpm test:node`         | Thin-client tests alongside other Node components.                    |
| `pnpm test:coverage`     | Node coverage, including the thin client.                             |
| GitHub Actions           | ARM64 packaging validation, **not Raspberry Pi hardware acceptance**. |
| Actual deployment target | Hardware readiness and performance.                                   |

- Prioritize memory correctness and durable replay over extensive setup mocks.
- Setup failures must explain remediation for unsupported OS/Python/native wheels or model errors.
- Real-model HTTP checks are opt-in. Default unit discovery does not download models or consume paid completions.

With the model already provisioned for the current HOME, run explicit HTTP integration checks:

```sh
BATTUTA_MEMORY_INTEGRATION=1 uv run --project memory-service --locked python -m unittest discover -s memory-service/tests -p test_mcp_integration.py -v
BATTUTA_MEMORY_INTEGRATION=1 pnpm --dir memory-client test:integration
```

| Integration check | Exercises                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Python            | Concurrent clients, scoped recall, membership/vector reuse, correction/history, and restart persistence. |
| JavaScript        | Durable capture after a lost acknowledgement/server restart without repeated extraction.                 |

Both checks:

- Use temporary data/ports, actual CPU embeddings, and official MCP clients.
- Stub extraction, so no model-provider charges occur.
- Do not provision models, contact Telegram, or modify live bot state.
