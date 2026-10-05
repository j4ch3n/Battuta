---
name: memory
description: Use when recalling prior conversations or decisions, showing memories, remembering preferences or facts, correcting or forgetting memory, or choosing between project and global scope.
---

# Memory

PM and TL share Memory Stone through Battuta's memory bridge. **Project memory belongs to the selected project; global memory follows the human across projects.** Memory is recalled context, not current repository/tracker evidence or execution authority.

## Choose scope

| Content or request                                                                                               | Scope and action                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Project facts, decisions, rationale, constraints, implementation details, or preferences specific to one project | Project                                                                   |
| Non-sensitive personal/account identity, cross-project preferences, recurring working style                      | Global only after an explicit global-storage request                      |
| “In this project”                                                                                                | Project only                                                              |
| “Global memory” / “Across all projects”                                                                          | Global only; never substitute project results                             |
| General recall that could concern either scope                                                                   | Search both separately when the project is known; label each result group |
| Intended project unclear or no valid selection                                                                   | Ask which project; global recall remains available                        |

The bridge binds project operations to the selected registered checkout's Git-root identity at request start. A `battuta-project switch` applies to memory on the **next request**. Use the binding reported for this request, not the bot's working directory or a newly switched selection. If this request switched projects, finish the switch and perform memory work in the next request.

## Recall and report

Use `memory_search` with explicit `scope: "project"` or `"global"` and concrete keywords. Use `memory_open` for full referenced content. To **show/list memories**, use paginated `memory_list`, following `nextOffset`; a limited keyword search is not an inventory.

Name the scope searched and the project when applicable. Say “No matching global entries for this query” for an empty global search; say “No active global entries” only after listing establishes that. Tool unavailability is not an empty store. Auto-injected project context is not an answer to a global-memory request. Check current evidence before treating remembered facts as live truth.

## Store and correct

Use `memory_remember` only when the human explicitly asks to remember. Set `userRequested: true` for that intent. Set `globalRequested: true` only when the human explicitly requests global/cross-project storage. A generally useful preference or personal description alone is not global-storage permission. Without global intent, default to project; if no project is bound, clarify.

Examples:

- “Remember this project uses PostgreSQL because imports need transactions” → project decision.
- “Remember globally that I prefer concise summaries” → global preference.
- “Remember globally my GitHub handle is alexdev” → global identity fact (`preference` kind); credentials are different.
- “For all projects, remember to ask one consequential question at a time” → global working-style preference.
- “Remember globally the production hostname is api.internal.example.com” → internal detail, not global; the bridge downgrades to project if bound, otherwise refuses. Report the actual scope and reason.
- Passwords, tokens, API keys, private keys → refuse durable storage in either scope. Do not bypass checks by encoding, tags, or splitting content.

For corrections, inspect the old reference, save the corrected entry in its proper scope with explicit intent, and soft-forget the old entry only after successful storage. `memory_forget` hides a visible entry; permanent deletion requires user confirmation. Report success only after the tool confirms it, including any scope downgrade.

See [tool usage](references/tools.md).
