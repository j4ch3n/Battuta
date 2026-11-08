import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { memoryRecordSchema, memoryProjectsSchema } from "./records.ts";
import { normalizedProjects, validateMemoryProjects } from "./projects.ts";

export class MemoryMcpClient {
  constructor(
    readonly url: string,
    private readonly writeCatalog?: (signal: AbortSignal) => Promise<readonly string[]>,
  ) {
    const endpoint = new URL(url);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.protocol !== "http:"
    )
      throw new Error("Memory URL must be loopback HTTP");
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    catalog?: readonly string[],
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (
      ![
        "memory_inventory",
        "memory_recall",
        "memory_get",
        "memory_remember",
        "memory_update",
        "memory_set_metadata",
        "memory_forget",
        "memory_link_projects",
        "memory_consolidate_global",
        "memory_global_relationships",
      ].includes(name)
    )
      throw new Error("Unsupported dream memory operation");
    if (name === "memory_remember") {
      const available = catalog ?? (await this.catalog(signal));
      validateMemoryProjects(args.projects, available);
    }
    if (name === "memory_link_projects") {
      const changes = z
        .object({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) })
        .parse(args);
      const available = normalizedProjects(catalog ?? (await this.catalog(signal)));
      const added = normalizedProjects(changes.add),
        removed = normalizedProjects(changes.remove);
      if (added.some((p) => removed.includes(p)))
        throw new Error("Memory project membership invalid");
      const record = memoryRecordSchema.parse(
        await this.call("memory_get", { ref: args.ref }, signal),
      );
      if (
        record.projects[0] === "global" ||
        added.includes("global") ||
        added.some((p) => !available.includes(p)) ||
        removed.some((p) => !available.includes(p) && !record.projects.includes(p))
      )
        throw new Error("Memory project membership invalid");
      validateMemoryProjects(
        [...new Set([...record.projects, ...added])].filter((p) => !removed.includes(p)),
        available,
      );
    }
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
  private async catalog(signal: AbortSignal): Promise<readonly string[]> {
    if (!this.writeCatalog) throw new Error("Memory project membership catalog unavailable");
    return this.writeCatalog(signal);
  }
  async capture(batch: Record<string, unknown>, signal: AbortSignal, catalog?: readonly string[]) {
    signal.throwIfAborted();
    const available = catalog ?? (await this.catalog(signal));
    const items = z.array(z.object({ projects: memoryProjectsSchema })).parse(batch.items);
    for (const item of items) validateMemoryProjects(item.projects, available);
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
