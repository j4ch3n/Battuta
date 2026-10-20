# Shared memory architecture and operations

The [component design](../memory-service/DESIGN.md) explains memory layers, scope versus kind, data ownership, capture, retrieval, and lifecycle invariants. This reference covers configuration and operations.

`memory-service/` exposes nine tailored MCP tools on loopback Streamable HTTP (`/mcp`, default port 8901). It composes mcp-memory-service 12.1.1's SQLite/embedding implementation through one pinned adapter; no upstream source is copied or forked. `memory-client/` is a thin Pi lifecycle integration, not another memory database. Other MCP clients can use the server independently of Pi.

## Persistence and scope

The default shared data directory is `~/.battuta/memory-service/`: upstream `memory.db`, application-owned `state.db`, a single-owner lock, and private per-role `capture-queue/` files. `BATTUTA_MEMORY_DATA_DIR` overrides the data path; model weights remain under the service user's HOME cache. Run bots and server under the same user. Protect these directories and backups as private conversation data.

Global facts use `scope:global`; project facts use `proj:<registered-name>`. One memory may belong to multiple projects. PM/TL have equal access: selection filters relevance, not authorization. Current-project recall includes global by default; explicit global/projects/all selectors are supported. Extra filters AND with scope. Registry errors are not silently converted into unscoped searches. No MEMORY.md or per-project memory database exists.

Exact duplicates reuse content identity and can attach evidenced project membership. Semantic near-duplicates remain distinct. Global/project collisions or inactive references are conflicts, not implicit scope broadening. Content updates create a new hash/version; membership changes reuse the stored embedding. Default recall/list/get omit superseded records. Forget tombstones one ref and retains content upstream; it is not secure erasure.

Wrapper kinds (including `preference`) are preserved in owned `kind:` tags independently of upstream's narrower type ontology. User-supplied tags cannot contain commas or reserved prefixes; this prevents CSV tag serialization from manufacturing extra scope or kind metadata.

The adapter uses serialized, read-only queries against the pinned schema for error-propagating inventory and exact filtered sqlite-vec distance ranking. This avoids swallowed upstream errors and global candidate-limit omissions, at the cost of linear work within the selected corpus. A narrow journal-owned orphan-lineage repair handles a process dying inside upstream's multi-commit version update. Upstream dependency upgrades require rerunning adapter contract tests.

Mutations journal intent in state.db before upstream writes, then record receipts. These two databases are not one transaction. Restart reconciles pending intents before accepting new operations. Completed receipts prevent replay from recreating later-forgotten content. Pending intents contain requested content until completed; completion clears the logical payload, not necessarily old SQLite/WAL/backup pages. This system makes no hard-erasure promise. Back up both databases consistently with the server stopped or via SQLite backup, along with any desired pending capture queue.

If upstream compensates a failed correction by tombstoning its replacement, recovery records a terminal failure instead of resurrecting that target or blocking unrelated writes. The original stays unchanged; retry a correction using current evidence and revised content rather than recycling the tombstoned target.

## Embeddings

MiniLM all-MiniLM-L6-v2 runs locally in ONNX Runtime CPUExecutionProvider, producing 384-dimensional vectors. Embed memory content, not project tags. Queries use the identical model/preprocessing. Provisioned weights/tokenizer are checksum verified and fingerprint-bound to the data directory. Missing/corrupt/changed models and hash fallback fail readiness, including on a fresh database. Inputs exceeding 256 tokenizer tokens are rejected rather than silently truncated. Model changes require an explicit migration/re-embedding workflow; V1 does not supply one.

No model-provider credential is required by the server. No dashboard, graph UI, dream/consolidation jobs, bootstrap, semantic dedup, automatic forgetting, or remote binding is exposed.

## Conversation capture

Both bots accumulate new persisted user/assistant text and labelled incoming agent mail, excluding system/profile content, thinking, attachments and raw tool results. First-seen resumed history is not backfilled. At settlement, redacted messages and their source cursor are atomically persisted even below the default six-message extraction threshold. Request-start project binding stays with the segment. Session switch/fork/compaction/shutdown flush smaller batches for later processing.

Extraction uses the bot's configured model/provider, not a new server-side LLM. It produces up to 20 concise cited facts per bounded segment. Output schemas, source IDs, scope and credential checks gate upload. Validated extracted batches are persisted before the first MCP call; network retries do not call the model again. A model token-limit rejection permits one rephrase under a distinct batch identity, then leaves failed work for inspection. Each boundary attempts at most two jobs with exponential backoff from one second to one minute; cancellation is not success. Failures are content-free statuses and never stop normal conversation. Additional extraction usage is recorded as a `memory-capture-usage` session entry.

Bot `.pi/settings.json` accepts `battutaMemoryCapture:{"enabled":true,"batchMessages":6}`; threshold range is 1–100. Settings are loaded when the adapter initializes, so restart after changes. Queues retain private source text until acknowledged. Inspect them locally if capture is stuck; do not paste them into chat or indiscriminately delete them. Failed extraction is best-effort memory, not guaranteed preservation of every conversation fact.

## Read-only owner profile

Only PM loads its existing `.pi/ME.md` (up to 32,000 bytes) before a request. TL does not load it. Missing profiles are normal; unreadable/oversized profiles cause a warning, not bot failure. There is no generator, updater, writer, or profile tool. SQLite writes never update ME.md. A future separately approved dream workflow may generate it; V1 does not.

## Breaking replacement and cutover

Stone is retired, not backward compatible. No old tool aliases, settings translators, dual reads/writes, legacy database loading, or automatic import remain. Setup removes obsolete owned package/extension/settings entries without interpreting their semantics. Existing private profiles, old `~/.battuta/memory/memory.db`, and old recovery queues are preserved and never replayed.

Before live cutover, obtain approval to stop existing bots, record existing data/profile paths, and take consistent backups (do not copy a live SQLite WAL database naively). Provision the new server separately, configure both native MCP entries, restart bots with the new adapter, then verify `memory_health`, one explicit scoped fact/recall, and a capture batch from each role. Confirm PM-only preload with temporary sentinel fixtures, never by exposing real profile text. Do not start duplicate bot processes. The isolated exploration server on port 8900 is unrelated and must not be killed.

Rollback is an operator-controlled previous-release restore, not compatibility inside the new system: stop new processes, preserve new data, and restore the old release/configuration using its separately preserved Stone store. Do not downgrade either schema or point the old release at the new database.

## Verification

`pnpm check:support` includes offline Python unit/adapter-contract tests; `pnpm test:node` and `pnpm test:coverage` include the thin client. Focus on memory correctness and durable replay rather than extensive setup mocks. GitHub Actions validates packaging on ARM64, not Raspberry Pi hardware. Installation must fail with clear remediation for unsupported OS/Python/native wheels or model errors. A local real-model MCP smoke is opt-in; no paid extraction model or model download belongs in default unit discovery. Hardware readiness/performance must be checked on the actual target when deploying.

With the model already provisioned for the current HOME, run explicit HTTP integration checks:

```sh
BATTUTA_MEMORY_INTEGRATION=1 uv run --project memory-service --locked python -m unittest discover -s memory-service/tests -p test_mcp_integration.py -v
BATTUTA_MEMORY_INTEGRATION=1 pnpm --dir memory-client test:integration
```

These use temporary data/ports, actual CPU embeddings and official Python/JS MCP clients; extraction is stubbed, so no provider charges occur. The Python check covers concurrent clients, scoped recall, membership/vector reuse, correction/history and restart persistence. The JS check exercises durable capture after a lost acknowledgement/server restart without repeated extraction. They do not provision models, contact Telegram or modify live bot state.
