# Battuta memory service

A headless, framework-independent MCP server for shared scoped memories, wrapping pinned mcp-memory-service storage and local ONNX embeddings.

- Global and multi-project memory with equal PM/TL access.
- Versioned corrections, tombstone forgetting, and recoverable capture ingestion.
- One shared SQLite store and verified offline embedding model.

See [release setup](../RELEASE.md#extension-and-skill-setup-index), [architecture and operations](../docs/memory-service.md), and [tool workflow](../shared-skills/memory/references/tools.md).
