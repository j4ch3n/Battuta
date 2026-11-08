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

Only CoS has managed memory MCP/client/skill exposure. Manager and workers receive
selected Agent Mail briefs and return attributed findings/corrections. Same-user
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
`mode:"semantic"` is available for targeted comparison. Literal keyword matching,
scope/eligibility-before-limit and dependency checks are described in the design.
Read/list calls require explicit `projects`, `global` or `all` selectors. Missing
selection and `current` are rejected. The server is independent of project files
and `BATTUTA_PROJECTS_ROOT`; that environment setting belongs only to client discovery.

## Request-origin contract

Before ordinary admission, the trusted origin integration must append a Pi custom
entry `memory-request-origin` with:

```text
{request_id, conversation_id, session_id, project, origin, admitted_at}
```

Project is a conversation hint or explicit `null` for general context; origin is
`owner`, `mail`, or `internal`; time requires a timezone offset. The consumer
validates this metadata, consumes it once with a `memory-request` custom entry,
and persists the frozen binding in capture segments. It does not infer identity
from prompt text or shared project selection. Forks/switches cannot reuse another
session's origin. Internal custom activity bypasses ordinary capture/recall.
For mail, `conversation_id` must match the delivered envelope; admission also
freezes its exact message reference. Queued follow-ups bypassing admission are not
authorized by a separate origin marker. Mixed segments remain blocked with
`blocked_reason: unbound-origin`, without a project binding; memory context and
commissions are suppressed. Preserve these jobs for attributed reconciliation,
not automatic replay under another request. Compaction preserves a continuing
request's binding; switches, forks and shutdown end it.

**The real producer remains gated on FIS-143/FIS-146.** Until it supplies this
contract, automatic capture/personalization and new commissions needing a binding
are unavailable. Manual CoS memory tools remain available. Two-real-conversation
safety is not yet accepted end to end. An admission instant's timezone does not by
itself establish the owner's timezone for interpreting relative event dates.

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
including multi-project facts, and receives bounded correction candidates. The
request project does not restrict classification. It cannot guess correction refs
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

Every validated ordinary admission attempts bounded recall under a three-second
total deadline, independently of agent tool choice. It uses current text,
same-conversation topic and identifiers, then checks scope, revisions, expiry and
essential evidence. Memory/profile are untrusted labelled context, not system
authority. Prior packets do not accumulate across requests, and late work cannot
attach to a different request.

Earlier pending capture suppresses memory/profile with `capture-pending`, rather
than risking an obsolete fact. Status distinguishes ready, partial and unavailable
from an empty result. Numerical retrieval rank/usage is not belief confidence.
The profile uses only eligible revision-cited claims from `dream-profile.json`;
missing/unverifiable claims are omitted, never replaced with raw `ME.md` text.

Each outgoing commission selects relevant `memory:<ref>` references or declares
`memory-context:none-relevant`. Runtime verifies a fresh, scoped, bounded brief;
it never forwards the whole recall packet or profile. Necessary counterevidence
also needs explicit selection. Invalid/missing/oversized selection blocks sending;
preparation failure produces an unavailable brief without recalled facts. Existing
Agent Mail validation checks the final envelope before transport, including nested
codemode sends/replies. Semantic relevance/privacy judgments still require CoS.
Delivered mail cannot be revoked: send a correction citing the earlier message.

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
CoS memory exposure and remove managed Manager/worker exposure, then use the
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
budget, measures cold/warm three-second preparation misses, and verifies the actual
origin producer with two real conversations. No production speedup or utility
improvement is claimed from mocks or a single integration timing.
