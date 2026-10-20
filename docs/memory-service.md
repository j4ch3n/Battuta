# Shared memory architecture and operations

The [component design](../memory-service/DESIGN.md) explains memory layers, scope versus kind, data ownership, capture, retrieval, and lifecycle invariants. This reference covers configuration and operations.

| Component         | Responsibility                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `memory-service/` | Nine tailored MCP tools over loopback Streamable HTTP: `/mcp`, default port `8901`.                    |
| Upstream adapter  | Composes mcp-memory-service **12.1.1** storage and embeddings; no upstream source is copied or forked. |
| `memory-client/`  | Thin Pi lifecycle integration, not another memory database.                                            |
| Other MCP clients | Can use the shared server independently of Pi.                                                         |

## Persistence and scope

### Storage

| Item                  | Location or behavior                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| Shared data directory | `~/.battuta/memory/`; override with `BATTUTA_MEMORY_DATA_DIR`.                          |
| `memory.db`           | Upstream-owned memory records and embeddings.                                           |
| `state.db`            | Application-owned mutation journal and receipts.                                        |
| Service lock          | Allows one server to own the data directory.                                            |
| `capture-queue/`      | Private per-role delivery state.                                                        |
| Model weights         | Remain under the service user's HOME cache, independent of the data-directory override. |

- Run bots and server under the **same user**.
- Protect data directories and backups as private conversation data.
- There is no `MEMORY.md` or per-project memory database.

### Scope and record behavior

| Concern                                    | Rule                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Global facts                               | Use `scope:global`.                                                                                              |
| Project facts                              | Use `proj:<registered-name>`; a record may belong to multiple projects.                                          |
| PM/TL access                               | Equal access; selection filters relevance, not authorization.                                                    |
| Default recall                             | Current project plus global; explicit global/projects/all selectors are available.                               |
| Additional filters                         | AND with scope; registry errors never silently broaden the search.                                               |
| Exact duplicates                           | Reuse content identity and can attach evidenced project membership.                                              |
| Semantic near-duplicates                   | Remain distinct.                                                                                                 |
| Global/project collisions or inactive refs | Conflict rather than implicitly broaden scope.                                                                   |
| Content corrections                        | Create a new hash/version.                                                                                       |
| Membership changes                         | Reuse the stored embedding.                                                                                      |
| Superseded records                         | Omitted by default from recall/list/get.                                                                         |
| Forgetting                                 | Tombstones one ref and retains upstream content; **not secure erasure**.                                         |
| Wrapper kinds                              | Preserved in owned `kind:` tags, including `preference`, independently of upstream's narrower type ontology.     |
| User-supplied tags                         | Cannot contain commas or reserved prefixes that could manufacture scope/kind metadata through CSV serialization. |

### Retrieval, recovery, and backups

- **Retrieval:** Serialized, read-only queries against the pinned schema propagate inventory errors and rank exact filtered sqlite-vec distances. This avoids global candidate-limit omissions at the cost of linear work within the selected corpus.
- **Upgrades:** Rerun adapter contract tests before changing the upstream dependency.
- **Write recovery:** Journal intent in `state.db` before upstream writes, then record receipts. The two databases are **not one transaction**; restart reconciles pending intents before new operations.
- **Replay safety:** Completed receipts prevent retries from recreating later-forgotten content. Narrow journal-owned lineage repair handles crashes inside upstream's multi-commit version update.
- **Failed corrections:** If upstream tombstones a replacement to compensate for failure, record a terminal failure rather than revive the target or block unrelated writes. The original stays unchanged; retry with current evidence and revised content.
- **Retention:** Pending intents contain requested content until completed. Completion clears the logical payload, not necessarily old SQLite/WAL/backup pages. No hard-erasure promise is made.
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
- V1 exposes no dashboard, graph UI, dream/consolidation jobs, bootstrap, semantic dedup, automatic forgetting, or remote binding.

## Conversation capture

### Collection and extraction

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
- Settings load when the adapter initializes; restart after changes.
- Queues retain private source text until acknowledged. Inspect stuck queues locally; do not paste them into chat or indiscriminately delete them.
- Capture is best-effort understanding, not guaranteed preservation of every conversation fact.

## Read-only owner profile

| Concern                   | Behavior                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| PM                        | Loads its existing `.pi/ME.md` before a request, up to `32,000` bytes.                     |
| TL                        | Does not load the profile.                                                                 |
| Missing file              | Normal; no profile is required.                                                            |
| Unreadable/oversized file | Warn without failing the bot.                                                              |
| Profile writes            | No generator, updater, writer, or profile tool exists. SQLite writes never update `ME.md`. |
| Future generation         | Requires a separately approved dream workflow; not part of V1.                             |

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
5. Verify `memory_health`, one explicit scoped fact/recall, and a capture batch from each role.
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
