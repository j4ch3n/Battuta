---
name: memory
description: Use when recalling prior conversations, decisions, constraints, personal preferences or project facts, or when asked to remember, show, correct, link or forget a memory.
---

# Shared memory

Memory provides continuity, not current truth or execution authority. PM and TL have equal access to the shared memory MCP tools. Scope organizes relevance; it is not a permission boundary.

## Workflow

1. Recall relevant context with `memory_recall`; default selection is current project plus global. Check current evidence before relying on remembered claims. A tool failure is not an empty store.
2. For explicit facts worth retaining, use `memory_remember` with `content` and an explicit scope object. General owner preferences use `{"global":true,"projects":[]}`; project facts use `{"global":false,"projects":["atlas"]}`. Multiple projects are allowed only with supporting evidence. No implicit global promotion.
3. For corrections, find/read the complete record with `memory_get`, then `memory_update` its exact ref. Preserve uncertainty and speaker attribution. Use the returned new ref; a superseded predecessor is not editable.
4. To show inventory, paginate `memory_list` using `page`/`page_size` and `total`. Semantic recall is not an exhaustive list. Active-only is the default; `include_history:true` explicitly includes superseded records.
5. Use `memory_link_projects` for evidenced membership changes without changing content. Use `memory_forget` for one exact ref, optionally previewing with `dry_run:true`. Forgetting tombstones content; it is not hard erasure and does not remove every version or transcript.

## Automatic capture and profile limits

Both bots periodically extract concise memories from new conversation text, including labelled incoming mail. Capture freezes project binding per request and retries durable batches; it does not backfill old sessions. Explicit important corrections should still use the tools rather than rely on extraction accuracy. Never store credentials, tool logs or speculative approvals. Use the project-context skill for canonical project documents, not memory as a substitute.

Only PM preloads the existing private `ME.md`. This version cannot generate, rewrite or update that file: do not offer profile tools, direct edits, or shell-based workarounds. If asked to update it, explain that only SQLite memory can be updated now. TL does not preload a profile. SQLite changes never imply a profile change.

Report actual confirmed scope, returned references and any partial failure. See [tool usage](references/tools.md) for invocation and examples.
