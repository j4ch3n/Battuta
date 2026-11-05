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
        "block_assignment",
        "claim_assignment",
        "close_assignment",
        "create_assignment",
        "finish_assignment",
        "get_assignment",
        "list_assignments",
        "locate_notes",
        "prepare_notes",
        "reactivate_assignment",
        "record_todo_result",
        "start_todo",
        "update_todo",
      ]);
      assert.ok(tools.every((t) => t.inputSchema && t.outputSchema));
      const created = await call(cos, "create_assignment", {
        project,
        goal: "Deliver",
        constraints: "No publishing",
        initial_todos: ["One"],
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
        descriptions: ["Two"],
      });
      assert.deepEqual(
        appended.result.todos.map((t) => t.position),
        [2],
      );
      const updated = await call(manager, "update_todo", {
        ...target,
        position: 2,
        expected_updated_at: appended.result.todos[0].updated_at,
        description: "Edited",
      });
      assert.equal(updated.result.todo.description, "Edited");
      assert.equal(
        (
          await call(cos, "update_todo", {
            ...target,
            position: 2,
            expected_updated_at: appended.result.todos[0].updated_at,
            status: "cancelled",
          })
        ).result.code,
        "stale_update",
      );
      const claimed = await call(manager, "claim_assignment", target);
      const execution = { ...target, claimed_at: claimed.result.assignment.claimed_at };
      const refused = await call(manager, "finish_assignment", execution);
      assert.equal(refused.isError, true);
      assert.deepEqual(
        refused.result.unfinished.map((t) => t.position),
        [1, 2],
      );
      const notes = await call(cos, "prepare_notes", { ...target, root: "/home/bot/.battuta" });
      assert.equal(
        notes.result.notes_path,
        `/home/bot/.battuta/projects/${project}/work/${target.assignment_id}/note.md`,
      );
      for (const todo of claimed.result.todos) {
        const started = await call(manager, "start_todo", {
          ...execution,
          position: todo.position,
          expected_updated_at: todo.updated_at,
        });
        const result = await call(manager, "record_todo_result", {
          ...execution,
          position: todo.position,
          expected_updated_at: started.result.todo.updated_at,
          outcome: "completed",
          summary: "Verified",
          evidence: ["tests/proof.ts"],
        });
        assert.equal(result.result.todo.status, "done");
        const stale = await call(manager, "record_todo_result", {
          ...execution,
          position: todo.position,
          expected_updated_at: started.result.todo.updated_at,
          outcome: "completed",
          summary: "Different",
          evidence: [],
        });
        assert.equal(stale.result.code, "stale_update");
      }
      assert.equal(
        (await call(manager, "finish_assignment", execution)).result.assignment.status,
        "done",
      );
      assert.equal((await call(cos, "locate_notes", target)).result.editable, false);
      const next = (
        await call(cos, "create_assignment", {
          project,
          goal: "Large read",
          initial_todos: ["First"],
        })
      ).result.assignment;
      await sql`insert into public.todos(assignment_id,position,description) select ${next.id},n,'Step' from generate_series(1001,2,-1)n`;
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
