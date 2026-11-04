import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { localEnv, type Result, withDatabaseTest } from "./helpers.ts";

const endpoint = () => new URL(`${localEnv("SUPABASE_URL")}/functions/v1/assignments`);
async function connect() {
  const client = new Client({ name: "assignment-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint(), {
      requestInit: { headers: { apikey: localEnv("SUPABASE_SECRET_KEY") } },
    }),
  );
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { result: result.structuredContent as unknown as Result, isError: result.isError };
}

Deno.test("remote MCP authenticates before discovery and exposes shared lifecycle/tools", () =>
  withDatabaseTest(async (sql, project) => {
    for (const apikey of [undefined, "invalid-key"]) {
      const response = await fetch(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apikey ? { apikey } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      await response.arrayBuffer();
      assert.equal(response.status, 401);
    }
    const cos = await connect();
    const manager = await connect();
    try {
      const tools = (await cos.listTools()).tools;
      assert.deepEqual(tools.map((t) => t.name).sort(), [
        "append_todos",
        "close_assignment",
        "create_assignment",
        "get_assignment",
        "list_assignments",
        "locate_notes",
        "prepare_notes",
        "update_todo",
      ]);
      assert.ok(tools.every((t) => t.inputSchema && t.outputSchema));
      const created = await call(cos, "create_assignment", {
        project,
        goal: "Deliver",
        constraints: "No publishing",
      });
      assert.equal(created.result.ok, true);
      const target = { project, assignment_id: created.result.assignment.id };
      const wrong = await call(manager, "get_assignment", {
        ...target,
        project: project + "-wrong",
      });
      assert.equal(wrong.isError, true);
      assert.equal(wrong.result.code, "not_found");
      const appended = await call(manager, "append_todos", {
        ...target,
        descriptions: ["One", "Two"],
      });
      assert.deepEqual(
        appended.result.todos.map((t) => t.position),
        [1, 2],
      );
      const updated = await call(manager, "update_todo", {
        ...target,
        position: 2,
        expected_updated_at: appended.result.todos[1].updated_at,
        status: "done",
        outcome: "Verified",
      });
      assert.equal(updated.result.todo.status, "done");
      assert.equal(
        (
          await call(cos, "update_todo", {
            ...target,
            position: 2,
            expected_updated_at: appended.result.todos[1].updated_at,
            status: "todo",
          })
        ).result.code,
        "stale_update",
      );
      const refused = await call(manager, "close_assignment", { ...target, status: "done" });
      assert.equal(refused.isError, true);
      assert.deepEqual(
        refused.result.unfinished.map((t) => t.position),
        [1],
      );
      const notes = await call(cos, "prepare_notes", { ...target, root: "/home/bot/.battuta" });
      assert.equal(
        notes.result.notes_path,
        `/home/bot/.battuta/projects/${project}/work/${target.assignment_id}/note.md`,
      );
      await call(manager, "update_todo", {
        ...target,
        position: 1,
        expected_updated_at: appended.result.todos[0].updated_at,
        status: "cancelled",
        outcome: "Not required",
      });
      assert.equal(
        (await call(manager, "close_assignment", { ...target, status: "done" })).result.assignment
          .status,
        "done",
      );
      assert.equal((await call(cos, "locate_notes", target)).result.editable, false);
      const next = (await call(cos, "create_assignment", { project, goal: "Large read" })).result
        .assignment;
      await sql`insert into public.todos(assignment_id,position,description) select ${next.id},n,'Step' from generate_series(1001,1,-1)n`;
      const read = (await call(manager, "get_assignment", { project, assignment_id: next.id }))
        .result;
      assert.equal(read.todos.length, 1001);
      assert.equal(read.todos[1000].position, 1001);
      assert.equal(
        (
          await call(manager, "close_assignment", {
            project,
            assignment_id: next.id,
            status: "cancelled",
          })
        ).result.assignment.status,
        "cancelled",
      );
    } finally {
      await cos.close();
      await manager.close();
    }
  }),
);
