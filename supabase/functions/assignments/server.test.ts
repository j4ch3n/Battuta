import assert from "node:assert/strict";
import { createAssignmentHandler, type Rpc } from "./server.ts";

async function call(rpc: Rpc, name: string, args: Record<string, unknown>) {
  const handler = createAssignmentHandler(rpc);
  const response = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await response.text();
  const payload = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice(6)
    : text;
  return JSON.parse(payload).result;
}

Deno.test(
  "MCP preserves exact update target/token and exposes structured business refusals",
  async () => {
    const token = "2026-11-04T12:00:00.123456+00:00";
    const result = await call(
      (name, args) => {
        assert.equal(name, "assignment_update_todo");
        assert.deepEqual(args, {
          p_project: "Atlas",
          p_assignment_id: "a3f91c2e",
          p_position: 2,
          p_expected_updated_at: token,
          p_status: "done",
        });
        return Promise.resolve({ data: { ok: false, code: "assignment_closed" }, error: null });
      },
      "update_todo",
      {
        project: "Atlas",
        assignment_id: "a3f91c2e",
        position: 2,
        expected_updated_at: token,
        status: "done",
      },
    );
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "assignment_closed");
  },
);

Deno.test("MCP sanitizes backend errors, throws, and malformed output", async () => {
  for (const rpc of [
    () => Promise.resolve({ data: null, error: { message: "private-sentinel", code: "500" } }),
    () => Promise.reject(new Error("private-sentinel")),
    () => Promise.resolve({ data: { ok: true, assignments: "private-sentinel" }, error: null }),
  ]) {
    const result = await call(rpc, "list_assignments", { project: "Atlas" });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "backend_error");
    assert.equal(JSON.stringify(result).includes("private-sentinel"), false);
  }
});
