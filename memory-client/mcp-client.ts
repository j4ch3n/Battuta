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
        { ok?: boolean; data?: { complete?: boolean } } | undefined;
      if (result.isError || !envelope?.ok || !envelope.data?.complete)
        throw new Error("Memory capture incomplete");
      return envelope.data;
    } finally {
      await client.close();
    }
  }
}
