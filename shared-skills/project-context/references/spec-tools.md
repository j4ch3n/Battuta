# Project-spec agent tools

Use these Pi tools for managed specifications and documents. They are loaded for both bots by the shared `project-spec` extension and own spec inventory, storage, versions, reviews, and decisions. The CLI owns project discovery, registration, selection, workspace context, Linear linkage, and memory; there is no spec-authoring or decision CLI.

## Read first

1. Use `battuta-project list` to discover registered projects, or `battuta-project current` to read the selected name. For workspace context, select the intended project and run `explain`. Call `inspect_specs` with the explicit project name to obtain its spec inventory; spec reads do not change CLI selection.
2. Use `describe_spec` with `project` and the exact display `name`. It returns version history, summaries, presence, coverage, fingerprints, and paths in one locked snapshot. Set `include_content: true` to get the full documents paired with those fingerprints; use this mode for reviewing rather than separately reading files that can change.
3. Use the responsibility prompt/template linked from SKILL.md to shape the requested document. These are authoring guidance, not permission to edit a saved version or invent implementation authorization.

All authoring tools receive complete Markdown text, not file paths, patches, or append fragments. A successful tool result identifies what was saved. Errors are failed tool results; no ordinary reply counts as a save.

## Inspect a project's specs

Call `inspect_specs` with an exact registered project name:

```json
{ "project": "atlas-api" }
```

The result contains only `schema_version` and `specs`. Each spec entry includes its name, versions, version summaries, and recorded checklist/review/decision metadata. An existing project with no index returns `{ "schema_version": 1, "specs": [] }` without creating storage. Project paths, checkout details, and configuration are not returned. Use `describe_spec` for actual artifact presence, resolved paths, review coverage, and full document content.

## PM: versioned document authoring

`init_spec(project, name, summary, content)` creates the first immutable version and returns its location. The tools derive storage from the document's display name. An existing name requires `update_spec`; collisions between different names with the same normalized storage name are rejected.

`update_spec(project, name, summary, content)` saves the next complete immutable version. Existing versions are never rewritten. All managed versioned documents—including product specifications, planning, task, and research artifacts—are persisted by PM; TL supplies technical content and evidence through the originating exchange.

```json
{
  "project": "atlas-api",
  "name": "API Design",
  "summary": "Add pagination to the list endpoint",
  "content": "# API Design\n\n## Requirements\n\nThe list endpoint returns a cursor for the next page.\n"
}
```

This fictional input illustrates `init_spec`/`update_spec`. Use real project names, requirements, and evidence. Read the returned version path before reporting a saved requirement to others. There is no prepare/publish stage or follow-up file write.

## TL: canonical checklist and review

`write_spec_checklist(project, name, summary, content)` fully replaces the single `checklist.md` shared across the named spec's versions. Use stable criteria identifiers; this is the sole review-criteria source. Do not create alternate checklist files or amend individual items using edit tools.

`write_spec_review(project, name, summary, content, spec_version, checklist_sha256)` fully replaces the single `review.md`. A canonical checklist must exist. Before reviewing, call `describe_spec` with `include_content: true` and assess its `contents.spec`/`contents.checklist` paired with the returned version and `fingerprints.checklist`. Supply those assessed references rather than guessing current inputs when the review ends. A historical version or previous checklist fingerprint can be recorded honestly; describe_spec reports stale coverage.

```json
{
  "project": "atlas-api",
  "name": "API Design",
  "summary": "Review pagination acceptance",
  "content": "# Review\n\nC1: Cursor requirement is explicit.\nC2: End-of-list behavior remains ambiguous.\n",
  "spec_version": "v2",
  "checklist_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

The hash and findings above are illustrative. Use the inspected checklist fingerprint and actual criteria/evidence. PM can read these artifacts but cannot write them. Replacing the checklist does not rewrite the review; existing coverage becomes stale until TL replaces the review against its chosen inputs.

## PM: terminal decision

Use [decision recording](decisions.md) after project-management selects go/no-go and establishes a rationale. Refinement happens through new versions while the spec is open. No-go and go both close the named spec permanently to artifact changes; read tools remain available.

## Persistence and recovery

The tools own spec metadata and document storage. Direct Pi `write`/`edit` to managed document locations is blocked for both roles. Native write/edit paths and managed persistence reject file and directory symlinks, including dangling links; fixed macOS system aliases are supported. Use regular file/directory copies for ordinary working files. To bring content into managed documents, read the source and submit its full Markdown through the owning role's authoring tool rather than linking or copying directly into managed storage. Do not use shell commands to bypass the document workflow. These guards are for the bot's file tools, not an operating-system sandbox; pre-call checks do not prevent another process from replacing path components before a filesystem operation.

Writes are serialized using a shared project lock. A recovery journal preserves prior bytes/modes until document changes and metadata commit; interrupted pre-commit writes are restored, and a committed metadata record is retained. After a failed/uncertain operation, read metadata before retrying. Do not infer a new version or recorded decision from an attempted call.

Read-only files mark saved spec versions and finalized artifacts. Existing unregistered documents are preserved, not automatically imported. See the [metadata contract](spec-metadata.md).
