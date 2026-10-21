# Artifact service

A read-only web catalog for explicitly registered HTML bundles and rendered Markdown stored elsewhere on the host. Original files stay in place; a local CLI manages registration and removal.

- Exact per-file allowlisting and direct serving
- SQLite catalog with live index refresh
- Explicit Alembic setup migrations

See [runtime behavior](../docs/artifact-service.md) and the [component setup index](../RELEASE.md#extension-and-skill-setup-index).
