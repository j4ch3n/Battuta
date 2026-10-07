# Memory bridge runtime

The shared `memory-stone/` extension owns Pi tools and lifecycle orchestration. It calls `pi-memory-stone@0.1.7` utilities directly, without invoking the upstream extension factory or loading its skill. [Memory scope and usage](../shared-skills/memory/SKILL.md) belong to the shared runtime skill.

## Install and launch

Run the existing PM/TL setup targets. Each installs the bridge's locked dependencies, links the shared memory skill, and removes retained direct Stone package entries from bot settings. Source and release launchers load `memory-stone/index.ts` for both roles. Releases bundle the bridge and its production dependencies. There is no separate `pi install` step for Stone.

Both launchers default `PI_MEMORY_STONE_DB_PATH` to `~/.battuta/memory/memory.db`. An override must be an absolute path accessible to both bots; set the same value in their common environment file. The bots must run under the same account or have explicit access to the same database. This is shared local storage, not multi-machine synchronization. Existing file-based memory and the old PM-local Stone database are not imported or deleted.

## Project binding and concurrency

The bridge reads Battuta's selected project from `~/.battuta/projects/.config.json`, validates its registration and real checkout, and resolves that checkout's Git root as the project ID (canonical checkout path if it has no Git metadata). It never uses the bot's working directory as a project identity. Moving a checkout changes the path identity; automatic relocation/remapping is not provided.

Binding and existing session-entry IDs are captured before Pi persists the current user prompt. Memory tools retain that binding through retries and mail-driven continuations; indexing and cleanup happen at Pi's `agent_settled` boundary, not an intermediate `agent_end`. Switches apply to the next request. Only entries added by that request are indexed. Resumed history and previously unbound requests are not backfilled. If no valid selection exists, project tools explain the missing binding and project history is skipped; global operations remain available.

SQLite uses Stone's WAL mode and five-second busy timeout. A process-shared initialization lock serializes schema initialization; short immediate transactions keep records, FTS, file activity, indexing checkpoints, and job completion atomic. Each bot owns its connection and session provenance; shutdown does not delete shared data.

At supported settlement, immutable recursively redacted jobs are persisted in a private `${PI_MEMORY_STONE_DB_PATH}.queue` directory before indexing. Jobs retain the original request binding and exact entries. A leased process-shared claim serializes recovery; startup and subsequent request/session boundaries retry at most ten database jobs, with exponential backoff from one second to one minute. Completed-job identities make replay safe after commit-before-file-removal crashes. Malformed jobs remain for inspection without blocking valid jobs. Failed queue publication retains work only in-process and reports degraded crash durability. Queued content is private local state, not part of a release.

Coverage begins with `before_agent_start` and settles at `agent_settled`. Standalone agent-mail runs without that initialization and stale-message backfill are not covered; durable recovery does not expand that boundary.

## Recall configuration

Optional bot-local `.pi/settings.json` configuration:

```json
{
  "battutaMemory": {
    "enabled": true,
    "maxRecords": 5,
    "maxTokens": 1000,
    "threshold": 0.3,
    "includeGlobal": true,
    "ownerProfile": false
  }
}
```

These defaults govern automatic recall/injection; `enabled: false` disables automatic recall, not explicit tools or project-history indexing. `maxRecords` is 1–20; `maxTokens` is a 50–4000 approximate budget (four characters per token). Global recall can be excluded with `includeGlobal: false`; explicit global tools still work. Configuration is read from the bot runtime, rather than Stone's process-cwd defaults. Recall settings take effect on the next request. Changing `ownerProfile` requires restarting the bot so profile loading and tool registration change together.

Recalled memory is scope-labelled, bounded, and audited per session. Historical context is not execution authority or proof of current repository/tracker state. Bot-managed records and automatically indexed history share storage but remain distinct record kinds. All memory tools run without owner approval: bots choose project/global scope when storing or searching, choose the profile update operation, and correct/delete references within their existing scope. There are no owner-request flags or confirmation prompts. Evidence and credential safeguards still apply.

Global writes describe non-sensitive personal background, interests, goals, preferences, and working style; tasks, implementation resolutions, and project/internal details remain project-scoped. The bridge supplements Stone's patterns with clearly labelled internal details and conversational credentials. Explicit credential writes are refused; history is recursively redacted before parsing/truncation. These deterministic checks complement the memory skill's content/scope judgment, not a guarantee that all sensitive content is recognized.

## Owner profile and record lifecycle

PM's explicit `ownerProfile: true` capability exposes `profile_read`/`profile_update` and loads private runtime `.pi/ME.md` at `before_agent_start` as a named prompt section. TL retains detailed personal/project tools without a duplicate owner profile. The [canonical template](../shared-skills/memory/references/ME.template.md) belongs to the memory skill and is embedded in the system prompt for every generation and refresh; a missing profile is normal and is not seeded during setup. Rewrites use the template's headings and order, configured session model, full existing document, owner evidence, and labelled interpretation. Validation, revision checks, cancellation, and locked atomic private writes protect replacement; semantic preservation/removal remains best-effort. New content loads next request, not via an external-edit watcher. Nested completion usage is reported in tool results.

SQLite correction atomically saves a replacement and retains its predecessor as inactive history, available through explicit inspection. `memory_forget` takes only a reference and always permanently deletes without an owner request or confirmation, with no soft-forget mode. Bots may invoke it autonomously; `/memory-forget <ref>` likewise deletes immediately. Project visibility checks and tool cancellation checks remain. Deletion works for active or historical references and atomically removes dependent FTS/activity/recall data. Scoped content-free suppression fingerprints prevent background indexing from restoring matching superseded/deleted records; intentional bot remembering can restore them without owner approval. Successful mutations invalidate the current session's extension-managed recalled section, not historical messages or other sessions' prompts.

The profile and SQLite are independent: neither tool family changes the other store, and neither promises erasure from already-sent prompts, transcripts, queued history, or backups. See [tool workflow](../shared-skills/memory/references/tools.md).

Setup enables PM's profile capability without seeding or overwriting `ME.md`, and disables that capability for TL while preserving other memory settings. Git ignore and archive export exclusions protect profile files, temporary writes, and database/recovery state; public skill resources remain bundled.
