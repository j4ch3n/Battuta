import { afterEach, expect, test, vi } from "vitest";
const transport = vi.hoisted(
  (): { result: Record<string, unknown>; closed: number; request: unknown } => ({
    result: {},
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
      return Promise.resolve(transport.result);
    }
    close() {
      transport.closed++;
      return Promise.resolve();
    }
  },
}));
import { MemoryMcpClient } from "../mcp-client.ts";
afterEach(() => {
  transport.closed = 0;
  transport.request = undefined;
});

test("returns structured inventory and closes the client", async () => {
  transport.result = { structuredContent: { ok: true, data: { records: [] } } };
  expect(
    await new MemoryMcpClient("http://127.0.0.1:8901/mcp").call(
      "memory_inventory",
      { window_start: 0, window_end: 1 },
      new AbortController().signal,
    ),
  ).toEqual({ records: [] });
  expect(transport.request).toEqual({
    name: "memory_inventory",
    arguments: { window_start: 0, window_end: 1 },
  });
  expect(transport.closed).toBe(1);
});

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
