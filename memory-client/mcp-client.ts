import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { memoryUrl } from "./config.ts";

export class MemoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface MemoryApi {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  uploadArchive(ndjson: string, signal: AbortSignal): Promise<unknown>;
}

export class MemoryClient implements MemoryApi {
  readonly url: string;
  constructor(url = memoryUrl()) {
    this.url = url;
  }

  async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const client = new Client({ name: "battuta-memory-client", version: "0.2.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.url)), { signal });
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 60_000,
      });
      const envelope = result.structuredContent as
        { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
      if (result.isError || !envelope?.ok || envelope.data === undefined)
        throw new MemoryError(
          envelope?.error?.code ?? "backend_unavailable",
          envelope?.error?.message ?? "Memory backend unavailable",
        );
      return envelope.data;
    } finally {
      await client.close();
    }
  }

  async uploadArchive(ndjson: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(new URL("/archive", this.url), {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: ndjson,
      signal,
    });
    const payload = (await response.json().catch(() => undefined)) as
      { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
    if (!response.ok || !payload?.ok)
      throw new MemoryError(
        payload?.error?.code ?? "backend_unavailable",
        payload?.error?.message ?? `Archive upload failed (${response.status})`,
      );
    return payload.data;
  }
}
