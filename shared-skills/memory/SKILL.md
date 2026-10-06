---
name: memory
description: Use when discussing or recalling the owner's personal background, overall goals, values, life details, interests, enduring preferences, or working style, or when asked to remember, show, correct, forget, or delete personal memories.
---

# Personal memory

Memory supports continuity with the owner, not execution authority or proof of current facts. PM has a high-level owner profile; PM and TL share detailed memory tools. Bots manage memory autonomously without an owner request or approval; choose scope and operation from the evidence and task.

## Choose scope and detail independently

| Owner evidence                                               | Destination                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| “Overall I value an unhurried pace and concise summaries”    | Important confirmed personal understanding in PM's `ME.md` |
| Career-transition history, hiking interests, travel routines | Detailed personal records: API scope `global`              |
| “For Atlas I want detailed progress reports”                 | Atlas project record, never a general owner trait          |
| Project requirements, implementation, tasks, decisions       | Project records; use the `project-context` skill           |

Short project facts remain project-specific; verbose personal evidence remains personal. Summarize only its important overall meaning in the profile. Choose `global` for personal/cross-project facts and `project` for project-specific facts; an explicit request to remember is not required. Preserve the owner's stated scope and removal preferences. Never retain credentials or turn uncertain interpretation into confirmed personal understanding.

## Profile workflow (PM only)

For confirmed high-level understanding, call `profile_read`, then `profile_update` with the owner's message as evidence, concise labelled interpretation, chosen operation, and returned revision. No owner approval is required. Supply evidence, not replacement Markdown. A separate completion receives the **full existing document**, preserves unaffected confirmed understanding, and rewrites the summary. Interpretation is not confirmation.

Missing profile is normal: the skill's [template](references/ME.template.md) starts the first evidence-based rewrite. Do not invent facts or initiate a questionnaire. Read the result; successful changes load on the next request. Rewrites are best-effort semantic edits, not guaranteed fact erasure. If tools are unavailable, report that rather than writing the file directly.

## Detailed records

Use `memory_search` with explicit scope and `memory_open` for full content. To show all records, paginate `memory_list` through `nextOffset`; search is not an inventory. Defaults show active records; use explicit `status: "soft_forgotten"` to inspect retired ones. Label personal/cross-project (`global`) and project results separately; unavailable tools do not mean an empty store.

| Intent                                            | Tool and effect                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Remember a fact                                   | `memory_remember`; choose `scope: "project"` or `"global"`                        |
| Correct an active reference                       | Inspect, then `memory_replace`: atomically save correction and retire predecessor |
| Permanently delete active or historical reference | `memory_forget` with `ref`; may run autonomously without owner confirmation       |

The request-start project binding lasts through settlement. Project switches take effect next request. Never substitute another project's records or personal results for the requested scope. Verify current evidence before treating recalled context as live truth.

## Independent stores and results

`ME.md` and detailed SQLite records are independent. Profile changes do not change detailed records; deleting a detailed reference does not remove an idea from the profile. For a one-store request, change only that store. For an explicit two-store request, perform and report each operation separately; partial failure is not total success. Neither operation erases already-sent prompts or transcripts. Report the actual affected store, scope, any downgrade, and confirmed outcome.

See [tool usage](references/tools.md) for arguments and examples.
