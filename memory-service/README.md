# Battuta memory service

A headless, framework-independent MCP server for shared scoped memories, wrapping pinned mcp-memory-service storage and local ONNX embeddings.

- Global and multi-project memory in one trusted local store.
- Versioned corrections, tombstone forgetting, and recoverable capture ingestion.
- Evidence-backed lifecycle metadata, expiry filtering, and scoped hybrid retrieval.
- One shared SQLite store and verified offline embedding model.

See [design: memory layers, scope, and lifecycle](DESIGN.md), [release setup](../RELEASE.md#extension-and-skill-setup-index), [operations](../docs/memory-service.md), and the [tool reference](../docs/memory-tools.md).
