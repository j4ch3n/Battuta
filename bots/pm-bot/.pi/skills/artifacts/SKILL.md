---
name: artifacts
description: Use when the owner wants to share, publish, discover, update, or withdraw an HTML page, interactive bundle, or Markdown artifact on the host.
---

# Artifacts

Use `battuta-artifact` to register original host files in the web catalog. Read the [command reference](references/commands.md) before operations; it owns flags, output, and removal semantics.

1. Identify the intended artifact, title, description, and exact entry/assets. Use the `project-context` skill when project discovery is needed. Confirm intended sharing scope if unclear; never include credentials or unrelated files.
2. Register the entry and explicit relative assets. Files stay in place, and edits become visible immediately. Extensions determine format; content inspection is not required.
3. Use JSON output to inspect success and return the resulting URL. A successful registration is not proof that the tunnel or every browser asset works; report verification accurately.
4. For metadata changes, use `update`. For asset changes, use `show`, then `replace-files` with the **complete desired file set**, including unchanged assets. Use the observed revision to detect conflicts.
5. To withdraw a page, use `deregister`. This removes discovery **and subsequent HTTP access**, but never deletes originals or revokes already downloaded content.

On a revision conflict, inspect again before retrying. On missing setup or unavailable source files, report the blocker; do not edit SQLite, copy files, or change service configuration as a workaround.
