# Memory bridge runtime

The shared `memory-stone/` extension owns Pi tools and lifecycle orchestration. It calls `pi-memory-stone@0.1.7` utilities directly, without invoking the upstream extension factory or loading its skill. [Memory scope and usage](../shared-skills/memory/SKILL.md) belong to the shared runtime skill.

## Install and launch

Run the existing PM/TL setup targets. Each installs the bridge's locked dependencies, links the shared memory skill, and removes retained direct Stone package entries from bot settings. Source and release launchers load `memory-stone/index.ts` for both roles. Releases bundle the bridge and its production dependencies. There is no separate `pi install` step for Stone.

Both launchers default `PI_MEMORY_STONE_DB_PATH` to `~/.battuta/memory/memory.db`. An override must be an absolute path accessible to both bots; set the same value in their common environment file. The bots must run under the same account or have explicit access to the same database. This is shared local storage, not multi-machine synchronization. Existing file-based memory and the old PM-local Stone database are not imported or deleted.

## Project binding and concurrency

The bridge reads Battuta's selected project from `~/.battuta/projects/.config.json`, validates its registration and real checkout, and resolves that checkout's Git root as the project ID (canonical checkout path if it has no Git metadata). It never uses the bot's working directory as a project identity. Moving a checkout changes the path identity; automatic relocation/remapping is not provided.

Binding and existing session-entry IDs are captured before Pi persists the current user prompt. Memory tools retain that binding through retries and mail-driven continuations; indexing and cleanup happen at Pi's `agent_settled` boundary, not an intermediate `agent_end`. Switches apply to the next request. Only entries added by that request are indexed. Resumed history and previously unbound requests are not backfilled. If no valid selection exists, project tools explain the missing binding and project history is skipped; global operations remain available.

SQLite uses Stone's WAL mode and five-second busy timeout. A process-shared initialization lock serializes schema initialization; short immediate transactions keep records, FTS, file activity, and indexing checkpoints atomic. Failure rolls back the checkpoint and permits retrying the current request. Each bot owns its connection and session provenance; shutdown does not delete shared data.

## Recall configuration

Optional bot-local `.pi/settings.json` configuration:

```json
{
  "battutaMemory": {
    "enabled": true,
    "maxRecords": 5,
    "maxTokens": 1000,
    "threshold": 0.3,
    "includeGlobal": true
  }
}
```

These defaults govern automatic recall/injection; `enabled: false` disables automatic recall, not explicit tools or project-history indexing. `maxRecords` is 1–20; `maxTokens` is a 50–4000 approximate budget (four characters per token). Global recall can be excluded with `includeGlobal: false`; explicit global tools still work. Configuration is read from the bot runtime, rather than Stone's process-cwd defaults. Changes take effect on the next request.

Recalled memory is scope-labelled, bounded, and audited per session. Historical context is not execution authority or proof of current repository/tracker state. Explicit user-requested records and automatically indexed history share storage but remain distinct record kinds.

Global writes are restricted to non-sensitive preferences/identity (`preference` kind). The bridge supplements Stone's patterns with clearly labelled internal details and conversational credentials. Explicit credential writes are refused; history is recursively redacted before parsing/truncation so user text, thinking, and tool errors do not retain recognised credentials. These deterministic checks complement the memory skill's content/scope judgment.

## Personal guidance

Copy [the example](../bots/AGENTS_personal.example.md) to optional local `bots/AGENTS_personal.md`, add confirmed non-sensitive personal guidance, and rerun configuration. Both source and release assembly append it after shared and role-specific instructions without changing those sources. The local file is ignored by Git and excluded from release archives. Updates to global memory do not automatically edit this instruction file.
