# Memory tools

Use these Pi tools from either bot. They operate on the request-bound project or explicitly global scope; there is no memory CLI or line-index editing.

| Tool              | Invocation and effect                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_search`   | Supply `query`, explicit `scope`, optional `kind`, and `limit` (1–20, default 5). Returns matching active records, references, scopes, and scores.                                                        |
| `memory_list`     | Supply explicit `scope`, optional `offset` and `limit` (1–50, default 20). Returns a page, total, and `nextOffset`; continue until null to enumerate that scope.                                          |
| `memory_open`     | Supply `ref` from a result. Returns full active content if global or visible in the bound project.                                                                                                        |
| `memory_remember` | Supply `kind`, `text`, `userRequested: true`, and scope. Global storage also requires `globalRequested: true`. Optional `tags` and `importance` (0–1). Read the returned actual scope and downgrade flag. |
| `memory_forget`   | Supply `ref` to soft-forget a visible entry on user request. `hard: true` requests permanent deletion and prompts for confirmation; without confirmation the entry remains.                               |

Kinds: `decision`, `preference`, `task`, `error_resolution`, `turn_summary`, `session_summary`. Use `decision` for durable project facts/rationale and `preference` for preferences or non-sensitive identity. Only `preference` records are eligible for global storage; project facts/history in other kinds are downgraded to project scope. Clearly internal details remain project-scoped even if misclassified as a preference. Automatic session history is stored as project-scoped turn summaries and error records; it is not an explicit global memory.

## Example: cross-project preference

Human: “Remember globally that I prefer concise summaries.”

```json
{
  "kind": "preference",
  "text": "The human prefers concise summaries.",
  "scope": "global",
  "userRequested": true,
  "globalRequested": true
}
```

After confirmed storage, say “Remembered globally: you prefer concise summaries.” If the tool refuses or downgrades, describe that actual outcome instead.

## Interactive commands

- `/memory-status`: shared database path, bound project identity, global-entry count, recall state.
- `/memory-search <keywords>`: project search; `/memory-search --global <keywords>`: global-only search.
- `/memory-open <ref>`: open a visible entry.
- `/memory-forget <ref> [--hard]`: forget a visible entry, with confirmation for permanent deletion.
- `/memory-last`: this session's last audited recall packet.

The bridge owns these commands. Installing Stone's upstream extension directly would register conflicting tools and bypass Battuta's project binding.
