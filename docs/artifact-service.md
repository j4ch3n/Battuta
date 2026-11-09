# Artifact service

The service exposes published artifacts and explicitly allowlisted host files at `/artifacts/`. HTML presentations and rendered Markdown use stable `/artifacts/a/<slug>/` URLs. New artifacts generate a minimal vendor-selected HTML bundle in the owning project as a draft; existing Markdown is published in place. Serving and withdrawal never copy, move or delete originals.

## Runtime boundaries

- FastAPI/Uvicorn binds only to `127.0.0.1:8000` by default. The existing tunnel must forward `/artifacts/...` unchanged.
- The local Click CLI owns SQLite writes; HTTP exposes no management API. An exact file allowlist is checked on every artifact request.
- Alembic creates/upgrades the schema only during explicit setup. Startup checks its revision and fails with setup guidance if missing or incompatible. Stop the service and back up the registry before an upgrade; destructive downgrades are unsupported.
- The registry has `artifacts` and `artifact_files` tables, plus Alembic's revision table. Status is constrained to `draft`/`published`, with a draft database default. Migration `0002_publication_status` preserves existing registrations as published and adds optional template/project/name identity; it does not relocate files. Updates, publication and file-list replacement are transactional; optional expected revisions detect conflicting changes.
- A persistent read-only aiosqlite connection checks SQLite `data_version` every second. SSE refresh hints update open indexes; a five-second browser fetch also covers silently buffered streams. Every catalog request queries SQLite, so no event delivery is required for correctness.

The default registry is `~/.battuta/artifacts/registry.sqlite3`. `BATTUTA_ARTIFACT_DB` overrides it for setup, CLI, and service; all must use the same value. `BATTUTA_ARTIFACT_BASE_URL` supplies published URLs and is validated before publication; set it in `.env.prod` from the `.env.example` entry and load it for direct CLI use. Initialization and draft inspection do not need it. It does not rewrite HTTP routes: preserve the `/artifacts` prefix.

## Project-owned initialization and publication

`init` requires an explicit registered project and never reads or changes selection. It reuses `ProjectRegistry.load(name)` directly without Linear credentials. The destination is `<managed-project-root>/artifacts/<artifact-name>/`, beside `code/`. Existing destinations are never merged or overwritten. Descriptor-relative exclusive directory/file creation rejects symlink ancestors and races between initializers. On an in-process failure, roll back the draft and remove only the newly created incomplete bundle; a directory left after process death is preserved and blocks retry until the operator inspects it.

The packaged starter owns `file-meta.json`: exact source inventory, purposes and initial sharing flags. Validate safe unique paths, types, regular sources and inventory completeness before output. Add only the resolved extension CSS and composed dependency notices. Escape title/description in HTML and serialize the inline import map script-safely. The descriptor stays private in the package. `init` returns the absolute directory, draft, annotated tree, guidance and capability summaries (purpose, public import names, local stylesheets, selected/required status).

`init` requires at least one explicit repeatable `--vendor`. The offline catalog owns pinned CDN ESM mappings, upstream CSS URLs, local style sources, dependency relationships and provenance/license resources. Selecting live-diagram includes Mermaid once in canonical order. JS remains inert until imported. Each resolved capability generates `vendor/<name>.css`, linked after base `styles.css`, with pinned upstream CSS imports where required and scoped maintained host rules. CSS/fonts load eagerly; no JS is downloaded by initialization. Reveal uses base CSS plus a scoped local treatment, not a global stock theme; use embedded mode when crafting a deck.

Base output is `index.html`, `styles.css`, `index.js`, `vendor/importmap.json`, and composed `NOTICE.txt`, plus resolved extension styles. HTML/base JS/CSS and extension CSS form the initial exact runtime allowlist; map/notices stay private. No usage guide is generated. Usage and activation examples live in the artifacts skill's owned references. Native import maps must be inline; the companion JSON is equal at generation time and must be synchronized manually after author edits. Copied CSS is editable, not an enforced runtime theme.

Drafts reserve their slug/project identity and are visible to local management, but never public HTML/JSON catalogs or direct entry/asset requests. Status is checked before opening any source; draft URLs return the same generic 404 as unknown resources. SSE events remain metadata-free refresh hints, including for draft changes.

`publish` revalidates stored runtime mappings and explicit additional files, then atomically exposes the draft and bumps its revision. An unchanged repeat is idempotent; stale expected revisions fail. Authors may replace/remove starter assets using a complete explicit `replace-files` set, retaining the managed root and `index.html` entry. Files are not recursively shared. Source edits do not change publication status and are live for published originals.

`add-file --type markdown` validates an existing absolute regular UTF-8 Markdown source and immediately creates a published single-file record pointing to it. It creates no bundle, wrapper or project and shares no adjacent files. The artifacts skill owns the single runtime command reference.

The separately published artifact wheel includes starter/catalog/style resources,
licenses, and migrations. It declares `battuta-project` as a dependency; release
installation supplies that release's project wheel explicitly to uv, rather than
embedding it inside the artifact wheel or bot archive. Provisioning invokes the
installed `battuta-artifact setup`, which upgrades Alembic to head. Startup still
never migrates.

Installed-wheel resource acceptance runs with `uv run --project artifact-service --locked python artifact-service/tests/resources.it.py`. It uses disposable files, not bot/model calls or production state. Real browser/CDN behavior requires separate authored-artifact review; mocked/offline tests do not verify it.

## Serving behavior and security

The entry extension selects HTML or Markdown. File extensions determine MIME types without inspecting content. Markdown uses markdown-it-py with raw HTML disabled; its sources must be UTF-8. Additional allowlisted Markdown files also render as HTML.

Relative assets retain their registered directory structure. Nested entry pages redirect to their exact public path so relative links resolve correctly. Root-relative URLs such as `/app.js` need the correct build base; external CDN assets remain external browser requests.

Source files are opened using descriptor-relative, no-symlink operations on POSIX hosts. The response streams that same open file handle through Starlette; it never reopens an unchecked path. Non-regular files and unregistered paths return generic errors without local filesystem details. There are no directory listings or arbitrary directory mounts. HTTP range/conditional-response optimizations are not provided for original files in v1.

Source edits are live, and deleted/moved sources become unavailable. File changes do not modify registry timestamps or trigger catalog events. Editing multiple bundle files is not an atomic publication; manage consistency in the source build. Responses use `Cache-Control: no-store`; configure the tunnel/CDN not to override it. Deregistration blocks subsequent lookups, not in-flight streams or already downloaded content.

**Only register trusted content.** HTML/JavaScript executes under the public site's origin. Markdown rendering does not sandbox other artifact HTML. Cloudflare Access should protect private artifacts. A compromised server process can read whatever its OS identity permits: the HTTP allowlist is not an OS sandbox. The service's read-only filesystem policy prevents writes, not unrelated reads; restrict account permissions accordingly. Hard links to other files are also governed by the account's permissions, not detectable as symlink escapes.
