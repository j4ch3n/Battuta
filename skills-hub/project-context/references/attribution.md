# Document sources and integration adaptations

The seven specification prompts preserve the wording of the locally generated GitHub Copilot skills from [GitHub Spec Kit v1.0.13](https://github.com/github/spec-kit/tree/v1.0.13). They were moved from `.github/skills/speckit-<entry>/SKILL.md` to `<entry>/prompt.md`; no parallel rewritten prompt set remains. The five templates were copied from the matching installed CLI's `core_pack/templates/` assets. Markdown formatting is normalized with Prettier.

Copyright GitHub, Inc. Original material is retained under the [MIT license](licenses/spec-kit-MIT.txt).

| Responsibility | Upstream command under `templates/commands/` | Upstream template under `templates/`  |
| -------------- | -------------------------------------------- | ------------------------------------- |
| specify        | `specify.md`                                 | `spec-template.md`                    |
| clarify        | `clarify.md`                                 | No new document template              |
| plan           | `plan.md`                                    | `plan-template.md`                    |
| tasks          | `tasks.md`                                   | `tasks-template.md`                   |
| checklist      | `checklist.md`                               | `checklist-template.md`               |
| analyze        | `analyze.md`                                 | Findings, not an output-file template |
| constitution   | `constitution.md`                            | `constitution-template.md`            |

The summary prompt, Markdown reference, and CLI Jinja skeleton are project-context-specific.

## Integration edits

- Prompt compatibility metadata points to project-context, and each prompt links to the common Workspace binding in `SKILL.md`.
- Natural-language requests supply upstream input placeholders; workflow spellings route to responsibility references instead of requiring slash commands.
- Setup-script calls are replaced by explicit feature/artifact resolution and direct shared-template reads. The CLI resolves project/checkout context; spec tools resolve managed documents. Prompts and templates use returned references rather than prescribe filesystem layout.
- Prerequisites are established from artifact contents rather than command history. Research examples use the current runtime's tools, with inline investigation when delegation is unavailable.
- Constitution reads resolve the adopted named principles document through spec tools; PM persists amendments as complete new versions. An empty legacy scaffold is not adopted principles.
- Specification setup selects a document name and uses managed authoring; preset resolution and feature-state persistence are replaced by shared-template reads and request-local document context.
- Managed document setup and template references resolve through spec tools rather than fixed filenames. Checklist persistence follows TL ownership and complete canonical replacements rather than upstream per-domain append files.
- Original hook sections and branch-hook instructions remain as source text but are explicitly inactive under Workspace binding. No hooks, registries, preset layers, installation, or CLI dependency is introduced.

All other authoring and review wording remains upstream, including template examples and command-reference tokens. Formatting normalization means the files are not byte-for-byte copies. Workspace binding defines how those tokens and path conventions are interpreted; completed project documents contain real content and references rather than unresolved template instructions.

The imported prompts and templates follow the project's Prettier formatting rules. Preserve original wording when changing their content, and document any future integration edits here.
