# Memory operations

The [component design](../memory-service/DESIGN.md) owns the record, retrieval,
capture, recall and dream contracts. This reference covers operating the existing
CoS Pi extension and loopback MCP service, not another daemon or model runtime.

## Storage and role boundaries

| Item                 | Location or behavior                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shared data          | `~/.battuta/memory/`; override with `BATTUTA_MEMORY_DATA_DIR`.                                               |
| `memory.db`          | Existing upstream content, embeddings, sources and owned lifecycle metadata.                                 |
| `state.db`           | Mutation/capture receipts, recovery intents, rebuildable FTS5 index and retained optional graph generations. |
| `capture-queue/cos/` | Private CoS delivery state. Other roles' old queues remain untouched.                                        |
| Dream state          | `dream-config.json`, `dream-lock.db`, `dream-state.json`, `dream-profile.json`, `dream.log`.                 |
| `ME.md`              | Preserved private owner text; never automatically treated as verified evidence or overwritten by v3 dreams.  |

Only the isolated recall agent has conversational memory MCP exposure. Main CoS
receives prepared context without memory tools or the memory skill. Capture and
approved dreaming retain programmatic access. Manager and workers receive
selected Agent Mail context and return attributed findings/corrections. Same-user
shell access still exists; this is not credential isolation or a security sandbox.
Protect all data, logs and backups as private conversation information. One server
owns the data lock. There is no per-project database or `MEMORY.md`.

Exact-content retries must have compatible scope, attribution and lifecycle
metadata. Conflicts never broaden project membership or extend expiry. Explicit
membership changes reuse embeddings; content corrections create versions. Ordinary
recall excludes superseded/rejected/stale/expired or unsupported claims. Explicit
history/expired retrieval is separate from physical tombstone discovery.

### Recovery and backups

- Journal intent before canonical writes, reconcile the keyword index, then record
  the receipt. The two databases are not a single transaction. Startup recovers
  pending intents and reconciles the index before lexical results are served.
- Lost acknowledgement reuses the frozen mutation/batch identity. Do not delete a
  pending queue/checkpoint to retry: its write may already have succeeded.
- Failed version-link compensation never resurrects a tombstoned replacement.
  Inspect persistent failures privately and retry with current evidenced content.
- Back up both databases consistently with the service stopped or through SQLite
  backup, together with client state/queues. Never naively copy a live WAL database.
- Forgetting is not secure erasure. Original content, receipts, SQLite/WAL pages,
  transcripts, logs, checkpoints, queues and backups may retain text.

## Embeddings and retrieval

The existing pinned local ONNX all-MiniLM-L6-v2 model uses 384-dimensional CPU
embeddings. Content/query preprocessing is identical. Keywords are a separate FTS5
index; they do not alter a fact's embedding. Inputs exceeding 256 tokenizer tokens
are rejected rather than silently truncated.

Provision models explicitly using the [setup guide](memory-service-setup.md).
Missing/corrupt/changed weights, tokenizer or hash fallback fail readiness, including
on an empty store. The service never downloads a replacement at startup or needs
chat-provider credentials. Model migration remains separate work.

Hybrid recall reports semantic/lexical branch availability. A failed branch may
yield labelled partial results; both failing is unavailable, not empty memory.
Omitting `keywords` runs semantic-only retrieval. Literal keyword matching,
scope/eligibility-before-limit and dependency checks are described in the design.
Recall defaults to every scope; only explicit project/global filters narrow it.
There is no shared selected/current project.
List calls require explicit `projects`, `global` or `all` selectors; `current` is
rejected. The server is independent of project files. Client discovery uses only
`~/.battuta/projects` through `battuta-project list --json`; no root override exists.

## Recall input and local trust

Ordinary user runs enter an awaited `before_agent_start` preparation block. No
request-origin marker or current-project selection is required. The child receives
the latest active compaction summary, up to ten retained human/assistant text
messages, and current text separately. Tools, thinking, mail, injected context and
other branches are excluded. Summary text is conversation context, not verified
evidence. Older context is available only through stored memory.

The child is an in-memory Pi SDK session with its own focused instructions and
direct recall/get tools. It does not inherit CoS skills/extensions, other MCP
servers, coding tools, codemode or discovery. Native Pi handles repeated tool
rounds; the child may skip a greeting, rewrite searches, inspect results and search
again. It returns skipped, ready, partial or unavailable before main CoS starts.
Custom/internal runs do not recursively prepare recall. Queued input admitted to
an existing run is not automatically another preparation boundary.

The service remains loopback-only. Any permitted local client can access all
scopes; project filtering is relevance, not authorization. Invocation IDs prevent
late results crossing sessions/runs, but are not origin authentication. Existing
blocked capture jobs remain preserved, not automatically replayed with new scope.

## Conversation capture

CoS capture defaults on. Each settled turn is immediately queued, preserving
speaker/source time and original mail identity; tools, hidden reasoning, internal
dreams, injected context and resumed old history are excluded. Source text is
redacted before persistence. No useful facts is a valid extraction result.

Before new extraction, the client loads `battuta-project list --json`, adds `global`
and persists the full catalog snapshot. Discovery failure retains sources for retry;
a successfully empty catalog permits global facts only. No additional slug/name
restriction is imposed. The server lowercases project names consistently for storage
and selectors; names differing only by case share membership. It performs no registry
lookup. `global` is reserved, including case variants of a registered project name.

The existing Pi completion classifies concise temporal facts across the full catalog,
including multi-project facts, and receives bounded correction candidates. Requests
and new capture segments carry no project hint or origin binding. It cannot guess correction refs
or change a correction target's full project membership.
Corrections upload through guarded version updates without waiting for dreaming.
Unknown source timezone establishes no automatic expiry. Model output is checked
again for scope, source attribution, labels and credential redaction before upload.

Valid entries save without waiting for project-invalid entries. Rejected entries
return to the same isolated memory sub-agent for one bounded correction attempt,
with original sources and catalog; accepted entries are not regenerated. Persisted
rejections remain visibly pending if correction fails. Invalid multi-project
memberships are rejected whole, not partially stripped or made global.

Queues freeze validated payloads before upload. At most two jobs run per recovery
attempt, with existing bounded retries/backoff. A token-limit failure permits one
durable rephrase identity. Async recovery does not block automatic recall; serialized
queue changes preserve both a new turn and a concurrently extracted frozen batch.
Rephrasing targets only failed embedding-limit entries after other items are
acknowledged; separately rejected project entries remain queued for correction.
Correction attempts are persisted before completion and exhausted invalid output
stays blocked, while frozen uploads remain retryable without another completion.
Pre-compaction waits only for the durable flush, then starts the same background
worker. Frozen retries and embedding rephrasing retain the original catalog; persisted
pre-upgrade deliveries keep their original keys/digests through a narrow adapter.

Bot `.pi/settings.json` accepts:

```json
{ "battutaMemoryCapture": { "enabled": true } }
```

`enabled` controls collection/extraction/uploads, including retries. Disabled
capture leaves existing files untouched and does not disable recall. Legacy
`batchMessages` values remain accepted/validated but no longer delay settled-turn
capture. Settings load when the adapter initializes; restart after changes.
Non-CoS roles cannot enable the extension. Failures produce content-free status;
queued capture is best-effort understanding, not proof a particular fact was saved.

## Automatic context and delegation

Every ordinary user-run preparation invokes the recall agent, independently of
capture enablement. There is no application recall deadline or round-count cap:
a stalled child can delay CoS until cancellation or an underlying failure. Native
provider/transport limits still apply. Session switch/fork and shutdown cancel
pending work; old packets do not accumulate. Available Pi operation cancellation
is forwarded to the child.

One recall tool accepts independent optional `semantic_query` and `keywords`.
The child rewrites them using history. Either branch can run alone; both combine
ranked results. Keyword phrases are literal, and semantic queries exceeding the
256-token limit are rejected for rephrasing. The server checks lifecycle, sources,
revisions, expiry and dependencies and renders whole evidence/counterevidence
groups as qualified bullets. Raw tags/ranks are not model context; machine
records remain available to capture and dream callers.

Earlier pending capture suppresses memory/profile with `capture-pending`, rather
than risking an obsolete fact. Status distinguishes ready, partial and unavailable
from an empty result. Numerical retrieval rank/usage is not belief confidence.
The parent separately loads shared `ME.md` (maximum 32,000 bytes), redacts it, and
labels it as owner-profile context, not verified facts or instructions. It is not
sent to the child, counted against the 2,000-byte recalled-evidence budget, or
gated on search success. Missing files are optional; unreadable/oversized profiles
are omitted without failing recall. No bot-local or sidecar fallback is injected.
Pending capture suppresses both profile and recalled facts. Expiring recalled
support invalidates recalled evidence without dropping a separately loaded profile.

Commission-time origin/ref-selection gates and the extra recall pass are removed.
CoS chooses relevant prepared evidence for Manager/workers and must not forward
the whole packet/profile. Agent Mail retains normal envelope validation. Delivered
mail cannot be revoked: send a correction citing the earlier message. Manual
remember/update/forget tools are no longer in main CoS's loadout; capture still
handles supported facts and corrections, without guaranteeing a particular save.

## Owner profile and nightly dream

Unattended dreaming requires separate owner approval and explicit setup. The pinned
CoS scheduler requests it at process-local 05:30; use consistent `TZ` configuration.
While CoS is stopped no job runs. Startup catch-up uses the same latest-run identity,
lock and checkpoint rather than a daemon or one job for every missed day.
Before local 05:30 the latest due run is yesterday's 05:30; at or after it, today's.
Existing 03:00 tasks are not migrated or removed. An old task with the owned ID/name
conflicts with setup and requires explicit manual removal by the owner first.

Missing-stage, temporal and changed durable evidence is pending regardless of age.
The first-release guard is 500 stored records (including inactive history) and
200,000 bytes of input. Overflow fails visibly. At most 20 pending inputs are
selected by oldest attempt then ref; failed/deferred/unselected work remains pending.

Cleanup, synthesis and challenge are separate validated structured calls, with one
invalid-output retry per stage. Publication saves facts/metadata, challenged claims,
then acknowledged replacements' retirements. Review never strengthens confidence.
Explicitly rejected interpretations remain excluded from ordinary recall. Old graph
tools/data are retained maintenance views, not mandatory v3 stages.

The eligible global sidecar profile refresh is deterministic; untracked `ME.md`
stays untouched. The existing isolated reflection call writes one private
timestamped `dream.log` line, at most 149 words including timestamp/separator.
It receives actual acknowledged changes, not hidden reasoning or the CoS transcript.
One invalid-output rewrite is allowed. The public summary comes from applied
operations, never the private reflection.

Checkpoint v3 stores stage/version, input fingerprint, validated artifacts, frozen
requests, acknowledgements, reviewed fingerprints and pending attempts. Stale
unpublished stages rebase; acknowledged/uncertain requests retain their identities.
Pending version-1/2 journaled mutations finish before v3, without rerunning old
graph/profile generation or inventing lifecycle review completion.

Successful tools return `complete` and their saved public summary. Pending/deferred
work or a terminal conflict returns `partial`; errors/cancellation/timeouts are not
success. Scheduler delivery itself does not prove the real CoS model called the
tool. The host uses the configured Pi completion/model, fresh evidence, no tools,
and existing ten-minute caller/shutdown cancellation. No provider fallback is added.

## Cutover and verification

Setup never starts bots, changes provider login, imports private history, or tests
by writing production memory. Obtain approval before stopping a deployment; retain
consistent data/client-state backups. Upgrade server and client together, configure
isolated recall exposure, disable main CoS memory MCP and remove managed Manager/worker exposure, then use the
filesystem/CLI checks in the [setup guide](memory-service-setup.md). Do not start a
second service on the same data/port. The unrelated exploration server on port 8900
must not be stopped. Rollback is an operator-controlled restore, not live downgrade.

Developer checks are listed in [code checks](../.agents/skills/battuta-verify/references/checks.md).
With the local embedding model already provisioned, isolated HTTP checks are:

```sh
BATTUTA_MEMORY_INTEGRATION=1 uv run --project memory-service --locked python memory-service/tests/mcp.it.py
BATTUTA_MEMORY_INTEGRATION=1 pnpm --dir memory-client test:integration
```

They use temporary state/ports and actual local CPU embeddings, stub chat completion,
and never provision models, contact Telegram or modify live bot state. The JS path
covers capture/restart/replay, alias recall, staged promotion, immediate correction,
profile suppression, dependent invalidation and retained history.

The fixed synthetic scenarios are developer fixtures, not personal owner history.
Retrieval/label/privacy checks are deterministic; they do not establish better
model synthesis or correct answers. Owner acceptance separately compares
discretionary, automatic semantic and hybrid answers under the same model/context
budget, observes preparation latency and cancellation, and verifies that separate
conversations do not share invocation packets. No production speedup or utility
improvement is claimed from mocks or a single integration timing.
