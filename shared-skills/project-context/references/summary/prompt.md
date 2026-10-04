# Maintain a project summary

Read [Workspace binding](../../SKILL.md#workspace-binding), then [the summary template](template.md). This responsibility describes the project as a whole, not one feature.

1. Read the current Summary file from `battuta-project explain`, applicable repository guidance, relevant memory, and confirmed conversation context.
2. Fill the overview with purpose, intended users and use cases, scope, and capabilities supported by evidence. Initialization provides a skeleton, not a substantive overview. For an older project without the file, create it at the reported Summary path.
3. Keep proposed capabilities separate from current behavior. Add the optional Proposed capabilities section only when there are actual proposals. Link to relevant specifications using references resolved through spec tools; do not duplicate their detailed requirements or assume their locations.
4. Preserve valid existing content and update the overview when confirmed scope or capabilities materially change. Retain explicit unknowns rather than inventing facts or approvals.
5. Save `SUMMARY.md` through existing file tools. Report the outcome concisely and ask one consequential question if needed.

The summary is the introduction; memory holds durable operational context; spec tools own detailed managed documents and product decisions. The CLI reports repository URLs and workspace locations separately. `explain` reads the summary but never edits it.

The CLI skeleton is rendered from the packaged `summary.md.j2`. The Markdown template is the authoring reference; they share core headings but serve different consumers.
