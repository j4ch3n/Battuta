# Artifact service

A read-only web catalog for project-owned presentations and existing Markdown. A local CLI initializes reference bundles as drafts, publishes them explicitly and withdraws access without deleting originals.

- Exact per-file allowlisting and direct serving
- Complete presentation examples with local dependencies and draft/publication management
- SQLite catalog with live index refresh
- Explicit Alembic setup migrations

See [runtime behavior](../docs/artifact-service.md) and the [component setup index](../RELEASE.md#extension-and-skill-setup-index).

The index's visual conventions are recorded in [index design](DESIGN.md).
