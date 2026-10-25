# Artifact service

The service exposes an artifact catalog and explicitly allowlisted original host files at `/artifacts/`. HTML bundles and rendered Markdown use stable `/artifacts/a/<slug>/` URLs. No source files are copied, linked, uploaded, or deleted.

## Runtime boundaries

- FastAPI/Uvicorn binds only to `127.0.0.1:8000` by default. The existing tunnel must forward `/artifacts/...` unchanged.
- The local Click CLI owns SQLite writes; HTTP exposes no management API. An exact file allowlist is checked on every artifact request.
- Alembic creates/upgrades the schema only during explicit setup. Startup checks its revision and fails with setup guidance if missing or incompatible. Stop the service and back up the registry before an upgrade; destructive downgrades are unsupported.
- The registry has `artifacts` and `artifact_files` tables, plus Alembic's revision table. Updates and file-list replacement are transactional; optional expected revisions detect conflicting changes.
- A persistent read-only aiosqlite connection checks SQLite `data_version` every second. SSE refresh hints update open indexes; a five-second browser fetch also covers silently buffered streams. Every catalog request queries SQLite, so no event delivery is required for correctness.

The default registry is `~/.battuta/artifacts/registry.sqlite3`. `BATTUTA_ARTIFACT_DB` overrides it for setup, CLI, and service; all must use the same value. `BATTUTA_ARTIFACT_BASE_URL` is required by the CLI and supplies the public URLs it prints; set it in `.env.prod` from the `.env.example` entry and load it for direct CLI use. It does not rewrite HTTP routes: preserve the `/artifacts` prefix.

## Serving behavior and security

The entry extension selects HTML or Markdown. File extensions determine MIME types without inspecting content. Markdown uses markdown-it-py with raw HTML disabled; its sources must be UTF-8. Additional allowlisted Markdown files also render as HTML.

Relative assets retain their registered directory structure. Nested entry pages redirect to their exact public path so relative links resolve correctly. Root-relative URLs such as `/app.js` need the correct build base; external CDN assets remain external browser requests.

Source files are opened using descriptor-relative, no-symlink operations on POSIX hosts. The response streams that same open file handle through Starlette; it never reopens an unchecked path. Non-regular files and unregistered paths return generic errors without local filesystem details. There are no directory listings or arbitrary directory mounts. HTTP range/conditional-response optimizations are not provided for original files in v1.

Source edits are live, and deleted/moved sources become unavailable. File changes do not modify registry timestamps or trigger catalog events. Editing multiple bundle files is not an atomic publication; manage consistency in the source build. Responses use `Cache-Control: no-store`; configure the tunnel/CDN not to override it. Deregistration blocks subsequent lookups, not in-flight streams or already downloaded content.

**Only register trusted content.** HTML/JavaScript executes under the public site's origin. Markdown rendering does not sandbox other artifact HTML. Cloudflare Access should protect private artifacts. A compromised server process can read whatever its OS identity permits: the HTTP allowlist is not an OS sandbox. The service's read-only filesystem policy prevents writes, not unrelated reads; restrict account permissions accordingly. Hard links to other files are also governed by the account's permissions, not detectable as symlink escapes.
