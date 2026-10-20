import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class MemoryMcpClient {
  constructor(readonly url: string) {
    const endpoint = new URL(url);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.protocol !== "http:"
    )
      throw new Error("Memory URL must be loopback HTTP");
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (
      ![
        "memory_inventory",
        "memory_get",
        "memory_remember",
        "memory_update",
        "memory_forget",
      ].includes(name)
    )
      throw new Error("Unsupported dream memory operation");
    const client = new Client({ name: "battuta-dream", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)), { signal });
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 30000,
      });
      const envelope = result.structuredContent as
        { ok?: boolean; data?: unknown; error?: { retryable?: boolean } } | undefined;
      if (result.isError || !envelope?.ok || envelope.data === undefined)
        throw Object.assign(new Error("Dream memory operation unavailable or conflicting"), {
          retryable: envelope?.error?.retryable !== false,
        });
      return envelope.data;
    } finally {
      await client.close();
    }
  }
  async capture(batch: Record<string, unknown>, signal: AbortSignal) {
    const client = new Client({ name: "battuta-capture", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)), { signal });
      const result = await client.callTool(
        { name: "memory_capture", arguments: batch },
        undefined,
        { signal, timeout: 30000 },
      );
      const envelope = result.structuredContent as
        { ok?: boolean; data?: { complete?: boolean; items?: { code?: string }[] } } | undefined;
      if (result.isError || !envelope?.ok || !envelope.data?.complete)
        throw Object.assign(new Error("Memory capture incomplete"), {
          rephrase: envelope?.data?.items?.some((i) => i.code === "embedding_limit") ?? false,
        });
      return envelope.data;
    } finally {
      await client.close();
    }
  }
}
