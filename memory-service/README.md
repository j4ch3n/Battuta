# Battuta memory service

A headless MCP server for Battuta's long-term memory, built on the [agent-memory](https://github.com/tigerless-labs/agent-memory) library: one store of markdown files with a rebuildable index.

- Hybrid recall (BM25 with the `cjk` tokenizer plus local Qwen3 embeddings) with weight and recency decay.
- Append-only archive of extracted Owner ↔ CoS conversation.
- A nightly dream that runs in a Claude Code worker: distill, consolidate, refresh project overviews.
- Full endpoint for CoS, read-only endpoint for Manager and `battuta-project`.

See [release setup](../RELEASE.md#extension-and-skill-setup-index), [operations](../docs/memory-service.md) and the [tool reference](../docs/memory-tools.md). The agent-memory library is MIT licensed; see [NOTICE](NOTICE).
