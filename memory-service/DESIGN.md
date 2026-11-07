# Shared memory design

## Purpose and ownership

Memory supplies revisable personal and project evidence, never execution authority
or a replacement for canonical project documents. Only the focused recall child
has conversational memory MCP tools; CoS receives prepared evidence and `ME.md`.
Manager and workers receive selected Agent Mail context and return attributed
findings/corrections. Configuration exclusion is not a same-user security sandbox.

The CoS Pi extension owns capture, isolated recall preparation, dreaming and profile loading.
The server owns storage, retrieval, evidence rendering, deterministic validation and replay. Pi owns
extension lifecycle, cancellation and `ctx.modelRegistry.complete()`; the server
has no chat model or provider credentials. There is no separate memory daemon
or model-authentication stack.

## Memory record contract

Canonical content, sources and lifecycle metadata stay in existing upstream rows.
The owned `memory_metadata` JSON key contains independent dimensions:

| Field            | Meaning                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `stage`          | `temporal`: not yet dream-reviewed; `durable`: reviewed, not permanent or certain.                                                 |
| `knowledge_type` | `fact`, `synthesized-observation`, or `hypothesis`.                                                                                |
| `confidence`     | `confirmed`, `supported`, `tentative`, or `disputed`; never a numerical belief probability.                                        |
| `status`         | `active`, `stale`, `superseded`, or `rejected`. Existing physical tombstones remain separate.                                      |
| `keywords`       | At most 20 unique terms, 80 characters each. Preserve display spelling; normalize Unicode/case for matching.                       |
| `mentioned_at`   | Nullable source-statement instant, not extraction time.                                                                            |
| `expires_at`     | Nullable exclusive current-recall boundary. Require an explicit timezone and normalize to UTC.                                     |
| `rationale`      | Concise explanation; required for derived claims.                                                                                  |
| `evidence`       | Links `{ref, revision, relation, requirement}`; relation is `supports` or `contradicts`, requirement is `historical` or `current`. |

`confirmed` means explicitly stated/endorsed with attribution, not independently
verified objective truth. A third-party report remains that speaker's report.
Observations describe patterns; hypotheses explain possible causes or preferences.
Neither age, repetition, review nor retrieval boosts confidence.

Facts require identifiable sources for automatic personalization. Source identity
remains `{agent_id, session_id, entry_id}`; optional `attribution` preserves speaker,
source instant/timezone and original mail sender/reference. Assistant suggestions,
forwarding and owner silence do not create owner confirmation or independent events.
Missing lifecycle remains unprocessed; malformed/missing scope or attribution is
preserved and deferred, never repaired by inventing global scope or sources.

At `now >= expires_at`, ordinary recall/profile/delegation omits the record. Explicit
`include_expired:true` recall can return expired active history. Expiration is not
withdrawal: expired historical evidence may support a pattern, while corrected,
rejected, superseded or revision-mismatched essential evidence invalidates it.
Current support must remain current. Dependency checks memoize visited states;
cycles are rejected on writes. Known counterevidence must travel with an inference
or the inference is omitted. No arbitrary TTL or physical deletion is automatic.

## Scope and identity

Each memory is global (`scope:global`) or belongs to one or more registered project
slugs (`proj:<slug>`), never both or neither. Scope is relevance, not authorization.
`kind` describes meaning, such as preference/decision/event; extra tags filter topics.
Reserved `scope:`, `proj:` and `kind:` prefixes and commas are not caller tags.

Recall defaults to `all`, never shared current-project selection. Optional explicit
`projects` narrows membership, including global unless disabled. Explicit `global`
remains available for maintenance. `current` is only a list-browsing selector,
not a recall selector or fallback.
Kind/tag filters narrow scope; matching several project memberships deduplicates.
Exact-ref reads do not inherit a current-project access restriction.

Refs are upstream hashes of trimmed/lowercased content. Compatible identical-content
retries reuse identity. Conflicting scope, attribution or lifecycle metadata is an
error, not permission to broaden membership, confidence or expiry. Explicit
`memory_link_projects` changes membership without re-embedding. Semantic merging
and upstream automatic conflict-tag mutations are disabled; CoS proposes changes.

`memory_update` creates a version with predecessor/successor lineage.
`memory_set_metadata` requires ref, expected revision, replay key and full owned
metadata; it merges unrelated JSON fields and reuses content identity/embedding.
Its optional `replacement_ref` records lifecycle supersession after the replacement
is acknowledged. Sources and original content remain accessible through history.
Status-only withdrawal may retain unchanged evidence links after their sources
are corrected or forgotten; new claims and explicit mutation guards stay strict.
`memory_forget` is an explicit tombstone, not secure erasure or bulk retirement.

Public revisions cover content, scope, source and lifecycle changes. Inventory also
supplies a meaningful review fingerprint across reachable claim/evidence state,
excluding stage/review bookkeeping. Stale dependency revisions separately remain
pending. Unchanged durable metadata is not rewritten just to record another review.

## Storage and retrieval

One server process owns the data-directory lock. Upstream owns `memory.db` and
SQLite/sqlite-vec embeddings. Battuta owns `state.db`: mutation/capture receipts,
recovery intents, a rebuildable FTS5 index with indexed revisions, and retained
optional global-graph generations. These databases are not one transaction.
CoS's private capture queue and dream checkpoint are delivery/review state, not
another canonical store. No per-project database or `MEMORY.md` is created.

Embeddings use pinned ONNX all-MiniLM-L6-v2, 384 dimensions, CPUExecutionProvider.
Content and queries share preprocessing; tags/keywords are not embedded into facts.
The untruncated 256-token limit is checked. Weights/tokenizer are provisioned
explicitly, checksum verified and bound to the data directory. Missing, corrupt,
changed or hash-fallback models fail readiness. Model migration is separate work.

Recall accepts independent optional `semantic_query` and literal `keywords` (terms
or phrases); at least one is required. Only requested branches execute. Combined
recall filters canonical scope, status, source/dependency eligibility and
expiry before either branch's candidate limit. Semantic SQL receives eligible refs
through bound `json_each` membership; FTS matches literal quoted Unicode-normalized
terms against content/keywords and joins current indexed revisions. Raw MATCH syntax
is never interpolated. Reciprocal-rank fusion uses constant 60 and stable ref ties;
ranking numbers are not belief confidence. Automatic calls cap each branch at 20.
One failed branch gives labelled partial results; both unavailable is an error.

Index reconciliation runs after journal recovery and canonical mutations, before
receipts complete, and before lexical results are served. Metadata-only keyword
changes need no embedding. Failed index/acknowledgement work is replayed through
the original mutation identity, including already-applied supersession.
`memory_list` is paginated browsing; bounded `memory_inventory` is all-scope review,
not semantic enumeration. Neither silently truncates a moving dream corpus.

## Request lifecycle, capture and recall

An awaited `before_agent_start` hook starts a fresh in-memory Pi SDK recall
session for ordinary user runs. Its input is the latest active compaction summary,
the last ten retained human/assistant text messages, and current input separately.
Tools, thinking, mail and earlier injected packets are excluded. The child has
only direct recall/get tools, a dedicated prompt, and no inherited CoS resources,
codemode, discovery, coding tools or mutation tools. Native Pi owns its repeated
tool/model rounds; the child can skip, rewrite searches, review, refine and finish.

No request-origin marker or origin producer is required. Local invocation identity
prevents stale results crossing sessions, without authenticating origins or
restricting scopes. Loopback clients can read all scopes. Existing opaque blocked
capture jobs remain preserved, not relabelled/replayed. Custom/internal activity
does not recurse into recall. Queued input admitted to an existing run may not
create a new preparation boundary; see [operations](../docs/memory-service.md#recall-input-and-local-trust).

Each settled CoS turn enters the durable queue immediately. Serialized queue writes
prevent extraction persistence racing with new turns. The existing Pi completion
extracts bounded attributed temporal facts and scoped correction targets supplied
by recall. Validate source IDs, confidence, dates, scope and credential redaction
before sending. Correction candidates include expired active history and bounded
supporting refs within the frozen scope. Unknown source timezone establishes no
automatic expiry.
Corrections use guarded version updates immediately, invalidating dependent claims
without waiting for dreaming. Batches freeze before upload; retries reuse their
digests and bounded backoff, not another paid extraction. Old frozen batches and
other roles' private queues are not relabelled or automatically imported.

Preparation runs independently of capture enablement. The child returns skipped,
ready, partial or unavailable. The parent verifies these against observed reads;
errors/incomplete output never become success. Revisions and eligibility are
rechecked before injection. Server recall/get text contains qualified bullets;
structured records and supporting provenance stay available privately for
maintenance and in-turn dependency-expiry checks. Whole claims and required
counterevidence fit a 2,000-byte final evidence budget or are omitted, not sliced.

There is no application recall deadline or call-count cap. A stalled child can
stall CoS until cancellation or an underlying provider/transport failure. Available
Pi operation cancellation, session replacement and shutdown invalidate pending
work. Prior packets are removed rather than accumulated across requests.

The parent separately injects shared `ME.md` as redacted, untrusted owner-profile
context, not verified facts or instructions. Its 32,000-byte limit is separate;
it is never sent to the child or replaced by `dream-profile.json`. Missing profiles
are optional; unreadable/oversized profiles are omitted without failing recall.
Profile loading survives skipped/unavailable recall. Earlier pending capture
suppresses both sections. Expired recalled support removes evidence, not the
independent profile. Reads do not overwrite private files.

## Dreaming and delegation

CoS's existing scheduler requests the approved dream at local 03:00, with startup
catch-up, the existing model selection and no tool-capable dream subagent.
Missing-stage, temporal and changed durable evidence is pending regardless of age.
Within the 500-record/200,000-byte guard, select at most 20 oldest-attempt inputs;
deferred/unselected work remains explicit and cannot starve untouched inputs.

The extension hard-codes cleanup → synthesis → challenge → publication. Each model
stage returns validated structured artifacts, with one invalid-output retry.
Every selected input needs retain/replace/merge/defer; every synthesis needs an
accept/reject/defer challenge. Challenge uses original evidence and contrary
scoped retrieval, not hidden reasoning. Empty synthesis is valid. With no eligible
pending inputs, validated empty stages avoid unnecessary model calls.

Publish facts/metadata, then challenged derived claims, then supersede only sources
whose replacements were acknowledged. Replacement evidence must explicitly name
the reviewed cleanup content, never blindly inherit lineage. Guard source coverage,
scope, revisions, confidence, rejection history and metadata. Rejected hypotheses
remain excluded from current recall. Deterministic checks cannot establish semantic
truth or recognize every paraphrased rejected interpretation: owner evaluation remains
necessary. Profile refresh uses actual eligible outputs, then the existing private
reflection/public-summary boundary. `ME.md` is not rewritten.

Checkpoint v3 persists stage, input fingerprint, schema/prompt versions, validated
artifacts, frozen requests, acknowledgements, reviewed fingerprints and pending
attempt progress. A cross-process lock prevents concurrent runs. Resume stale
unpublished stages against fresh evidence; never regenerate acknowledged/uncertain
requests. Finish legacy journaled operations using their original identities before
v3, without rerunning old graph/profile reasoning or inventing review completion.
On a later scheduled day, unpublished failed batches rotate by attempt order only
when no mutation request is frozen; their pending work and legacy receipts remain.
Oversized inventory and partial publication remain visibly incomplete.

Old global-relationship tools/data remain optional, revision-checked maintenance
views. V3 dreaming never requires `memory_consolidate_global` or graph hints.

There is no commission-time origin/ref-selection gate or second recall pass.
CoS chooses relevant prepared evidence for Agent Mail and must not forward the
whole packet/profile. Preserve uncertainty and necessary counterevidence. The
existing Agent Mail validator checks envelope/size before transport. Delivered
mail cannot be revoked; CoS sends a referenced correction when context changes.
Direct manual memory mutation tools are absent from main CoS; existing capture
and approved dream adapters retain their programmatic operations.

## Preservation and deliberate limits

Intent/receipt replay preserves prior outcomes even after later corrections or
forgetting. Tombstones, SQLite/WAL pages, transcripts, queues, receipts, checkpoints,
logs and backups may retain text: no secure-erasure claim is made. Back up both
databases consistently together with private client state. Do not downgrade a live
store or delete pending work as a retry mechanism.

No generalized graph retrieval, reranker/cache, background indexer, arbitrary
retention TTL, automatic private-history import, expanded inventory capacity,
remote authentication or per-agent sandbox is included. See
[operations and verification](../docs/memory-service.md) and the
[tool workflow](../skills-hub/memory/references/tools.md).
