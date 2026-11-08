import { afterEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(
  (): {
    result: Record<string, unknown>;
    results: Record<string, unknown>[];
    closed: number;
    request: unknown;
  } => ({
    result: {},
    results: [],
    closed: 0,
    request: undefined,
  }),
);
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect() {
      return Promise.resolve();
    }
    callTool(request: unknown) {
      transport.request = request;
      return Promise.resolve(transport.results.shift() ?? transport.result);
    }
    close() {
      transport.closed++;
      return Promise.resolve();
    }
  },
}));
import { MemoryMcpClient } from "../mcp-client.ts";
import { record } from "./fixtures/record.ts";

test.each([{ projects: ["unknown"] }, { projects: [] }, { projects: ["global", "atlas"] }])(
  "rejects invalid direct writes before opening transport: %j",
  async ({ projects }) => {
    transport.result = { structuredContent: { ok: true, data: {} } };
    const client = new MemoryMcpClient("http://127.0.0.1:8901/mcp", () =>
      Promise.resolve(["atlas", "global"]),
    );
    await expect(
      client.call("memory_remember", { projects }, new AbortController().signal),
    ).rejects.toThrow("membership");
    expect(transport.closed).toBe(0);
    expect(transport.request).toBeUndefined();
  },
);
test("validates the complete capture before sending and keeps frozen catalog spelling", async () => {
  const client = new MemoryMcpClient("http://127.0.0.1:8901/mcp");
  transport.result = { structuredContent: { ok: true, data: { complete: true } } };
  await expect(
    client.capture(
      { items: [{ projects: ["Atlas"] }, { projects: ["unknown"] }] },
      new AbortController().signal,
      ["Atlas", "global"],
    ),
  ).rejects.toThrow();
  expect(transport.request).toBeUndefined();
  await client.capture({ items: [{ projects: ["Atlas"] }] }, new AbortController().signal, [
    "Atlas",
    "global",
  ]);
  expect(transport.request).toMatchObject({
    name: "memory_capture",
    arguments: { items: [{ projects: ["Atlas"] }] },
  });
});
afterEach(() => {
  transport.closed = 0;
  transport.request = undefined;
  transport.results = [];
});

test.each([false, true])(
  "membership removal accepts an attached retired label but never an invented addition (%s)",
  async (invalidAddition) => {
    const client = new MemoryMcpClient("http://127.0.0.1:8901/mcp", () =>
      Promise.resolve(["atlas", "global"]),
    );
    const target = { ...record(), projects: ["atlas", "retired"] };
    transport.results = [{ structuredContent: { ok: true, data: target } }];
    transport.result = { structuredContent: { ok: true, data: { ref: target.ref } } };
    const pending = client.call(
      "memory_link_projects",
      { ref: target.ref, remove: ["retired"], add: invalidAddition ? ["invented"] : [] },
      new AbortController().signal,
    );
    if (invalidAddition) {
      await expect(pending).rejects.toThrow("membership invalid");
      expect(transport.closed).toBe(1);
      expect(transport.request).toMatchObject({ name: "memory_get" });
    } else {
      expect(await pending).toEqual({ ref: target.ref });
      expect(transport.request).toMatchObject({ name: "memory_link_projects" });
      expect(transport.closed).toBe(2);
    }
  },
);

test("new writes fail closed without a catalog provider", async () => {
  await expect(
    new MemoryMcpClient("http://127.0.0.1:8901/mcp").call(
      "memory_remember",
      { projects: ["atlas"] },
      new AbortController().signal,
    ),
  ).rejects.toThrow("catalog unavailable");
  expect(transport.request).toBeUndefined();
});

test.each(["memory_inventory", "memory_consolidate_global", "memory_global_relationships"])(
  "dispatches %s and closes the client",
  async (name) => {
    transport.result = { structuredContent: { ok: true, data: { records: [] } } };
    expect(
      await new MemoryMcpClient("http://127.0.0.1:8901/mcp").call(
        name,
        { window_start: 0, window_end: 1 },
        new AbortController().signal,
      ),
    ).toEqual({ records: [] });
    expect(transport.request).toEqual({
      name,
      arguments: { window_start: 0, window_end: 1 },
    });
    expect(transport.closed).toBe(1);
  },
);

test.each([false, true])(
  "propagates retryability without leaking server content (%s)",
  async (retryable) => {
    transport.result = {
      isError: true,
      structuredContent: { ok: false, error: { retryable, message: "private rejected fact" } },
    };
    const error = await new MemoryMcpClient("http://127.0.0.1:8901/mcp")
      .call("memory_update", {}, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ retryable });
    expect(String(error)).not.toContain("private rejected fact");
    expect(transport.closed).toBe(1);
  },
);
