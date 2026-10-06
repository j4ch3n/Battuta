# Memory tools

PM profile tools affect only `ME.md`. Detailed-record tools are available to PM and TL and affect only SQLite. There is no memory CLI or line-index editing. All memory operations may run autonomously without an owner request or approval. Choose scope and operation from the evidence and task; bot interpretation does not establish a confirmed fact.

## High-level owner profile

1. Call `profile_read({})`; read `content`, `exists`, and `revision`. A missing profile returns revision `missing` without creating a file.
2. Call `profile_update` with `message` (the owner's evidence/request), `interpretation` (concise labelled supporting interpretation), chosen `operation` (`remember`, `correct`, `retire`, or `delete`), and `expectedRevision` from the read.
3. Read `updated`, affected `store`, `path`, new `revision`, and nested-model `usage`, or the error. On conflict read again and reassess the evidence; do not blindly overwrite.

Human: “Remember in my profile that overall I value an unhurried pace.” After reading revision `abc`:

```json
{
  "message": "Remember in my profile that overall I value an unhurried pace.",
  "interpretation": "Owner-confirmed overall collaboration preference, not a project deadline.",
  "operation": "remember",
  "expectedRevision": "abc"
}
```

The tool supplies the full current document (or skill template) to a separate completion using the configured session model. Do not provide replacement Markdown or arbitrary paths. No available model, invalid output, cancellation, or revision conflict leaves the file unchanged. Successful rewrites load on the next request. Removing an idea is a best-effort profile edit, not a guarantee of semantic erasure.

## Detailed personal and project records

API scope `global` means personal/cross-project; `project` means the request-bound project. Non-sensitive background, interests, goals, preferences, and working style are eligible personal content. Project details are not personal just because the owner said them. Tasks and implementation resolutions remain project-scoped. Read returned scope/downgrade rather than claiming the requested scope was used.

| Tool              | Invocation and effect                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_search`   | `query`, explicit `scope`, optional `kind`, `limit` (1–20, default 5). Active matches and references.                                                               |
| `memory_list`     | Explicit `scope`, optional `offset`, `limit` (1–50, default 20), `status` (`active` default or `soft_forgotten`). Follow `nextOffset` until null for an inventory.  |
| `memory_open`     | `ref`, optional `status` (`active` default or `soft_forgotten`). Full visible content.                                                                              |
| `memory_remember` | `kind`, `text`, chosen `scope` (`project` or `global`; omitted defaults to project). Optional `tags`, `importance` (0–1). No owner approval.                        |
| `memory_replace`  | `ref`, `kind`, corrected `text`; optional `tags`, `importance`. Atomically corrects in the predecessor's scope and retires it. No owner approval.                   |
| `memory_forget`   | `ref` only. Always permanently deletes an active or historical reference immediately, without owner request or confirmation. Project visibility checks still apply. |

Kinds: `decision`, `preference`, `task`, `error_resolution`, `turn_summary`, `session_summary`. Use `preference` for personal preferences/background/interests. Background history indexing remains project-scoped; bots choose the scope for tool-created records. Correction and deletion use the reference's scope and cannot access another project's records.

Human: “Remember across conversations that I enjoy hiking and am learning Spanish”:

```json
{
  "kind": "preference",
  "text": "The owner enjoys hiking and is learning Spanish.",
  "scope": "global"
}
```

For “For Atlas only, remember I want detailed progress reports,” use `scope: "project"` only when already bound to Atlas; otherwise select Atlas and wait until the next request. Do not update the owner profile from that project-specific preference.

For a correction, inspect the active reference, then use `memory_replace` to save the correction and retain its predecessor as inactive history atomically. To inspect that history, use `memory_open({"ref":"mem-2","status":"soft_forgotten"})`. To delete that reference, use `memory_forget({"ref":"mem-2"})`; verify tool success before reporting deletion.

Use `memory_forget` for permanent deletion; there is no soft-forget mode or owner-confirmation step. Deletion and correction suppress automatic replay of the removed or superseded content; an intentional `memory_remember` call can restore it without owner approval. Background history indexing cannot restore it. This does not erase queued files, transcripts, backups, or already-sent prompts.

## Store-specific requests

“Remove hiking from my profile only” → read profile, then `profile_update` with `operation: "delete"` and the exact request as evidence; do not call detailed-record tools. “Delete this SQLite reference, leave ME.md alone” → only `memory_forget`. When changing both stores, report the two outcomes independently. No synchronized deletion or cleanup is implied.

## Interactive commands

- `/memory-status`: database path, bound project, personal-entry count, recall state.
- `/memory-search <keywords>`: project search; `--global` selects personal scope.
- `/memory-open <ref>`: open an active visible entry.
- `/memory-forget <ref>`: permanently deletes a record immediately without confirmation.
- `/memory-last`: this session's last audited recall packet.

The Battuta memory bridge owns these commands and their request-bound project scope.
