import { assertEquals } from "@std/assert";
import { createHandler } from "./handler.ts";

const instruction = {
  schema_version: 1,
  summary: "Task",
  objective: "Work",
  scope: ["Parser"],
  constraints: [],
  inputs: [],
  acceptance_criteria: [{ id: "c1", expectation: "Pass" }],
  deliverables: ["Tests"],
};
const row = {
  id: "12345678-1234-4234-8234-123456789abc",
  key: "k",
  project: "Battuta",
  ticket_id: null,
  delegator_role: "pm",
  instruction,
  created_at: "2026-10-07T00:00:00Z",
  claimed_by: "host",
  claimed_at: "2026-10-07T00:00:00Z",
  opencode_session_id: null,
  terminal_report: null,
  finished_at: null,
  result_message_ref: null,
};
const delegation = { operation: "delegate", key: "k", project: "Battuta", instruction };
const bind = { operation: "bind", task_id: row.id, session_id: "s" };
const report = {
  schema_version: 1,
  state: "failed",
  summary: "Failed",
  checks: [],
  artifacts: [],
  failure: "Preparation failed",
};
function setup(role = "worker", data: unknown = row, code: string | null = null) {
  const state = { data, stored: row as unknown, code };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler = createHandler({
    getUser: () =>
      Promise.resolve({
        data: {
          user: {
            id: "u",
            role: "authenticated",
            app_metadata: {
              battuta: {
                role,
                projects: ["Battuta"],
                ...(role === "worker" ? { worker_id: "host" } : {}),
              },
            },
          },
        },
        error: null,
      }),
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === "task_pool_get_owned" ? state.stored : state.data,
        error: state.code ? { code: state.code, message: "private detail" } : null,
      });
    },
  });
  const send = (body: unknown, auth = "Bearer token") =>
    handler(
      new Request("http://local", {
        method: "POST",
        headers: { authorization: auth },
        body: JSON.stringify(body),
      }),
    );
  return { handler, send, calls, state };
}
for (const role of ["pm", "tl"])
  Deno.test(`delegation derives ${role} and returns a raw row`, async () => {
    const { send, calls } = setup(role);
    const response = await send(delegation);
    assertEquals(response.status, 200);
    assertEquals(await response.json(), row);
    assertEquals(calls, [
      {
        name: "task_pool_delegate",
        args: {
          p_role: role,
          p_key: "k",
          p_project: "Battuta",
          p_ticket_id: null,
          p_instruction: instruction,
        },
      },
    ]);
  });
for (const [role, body] of [
  ["pm", { operation: "claim", projects: ["Battuta"] }],
  ["tl", { operation: "list_owned" }],
  ["worker", delegation],
] as const)
  Deno.test(`${role} cannot invoke ${body.operation}`, async () => {
    const { send, calls } = setup(role);
    assertEquals((await send(body)).status, 403);
    assertEquals(calls.length, 0);
  });
for (const [role, body] of [
  ["pm", { ...delegation, project: "Other" }],
  ["worker", { operation: "claim", projects: ["Battuta", "Other"] }],
] as const)
  Deno.test(`rejects unauthorized project in ${body.operation}`, async () => {
    const { send, calls } = setup(role);
    assertEquals((await send(body)).status, 403);
    assertEquals(calls.length, 0);
  });
Deno.test("claim returns null without inventing an execution", async () => {
  const { send, calls } = setup("worker", null);
  assertEquals(await (await send({ operation: "claim", projects: ["Battuta"] })).json(), null);
  assertEquals(calls[0], {
    name: "task_pool_claim",
    args: { p_worker_id: "host", p_projects: ["Battuta"] },
  });
});
Deno.test("targeted claim forwards the exact ID through the authorized worker RPC", async () => {
  const { send, calls } = setup();
  const response = await send({ operation: "claim", projects: ["Battuta"], task_id: row.id });
  assertEquals(response.status, 200);
  assertEquals(calls, [
    {
      name: "task_pool_claim",
      args: { p_worker_id: "host", p_projects: ["Battuta"], p_task_id: row.id },
    },
  ]);
});
for (const task_id of [null, "", "bad", 3])
  Deno.test(`rejects invalid targeted claim ID ${task_id}`, async () => {
    const { send, calls } = setup();
    assertEquals((await send({ operation: "claim", projects: ["Battuta"], task_id })).status, 400);
    assertEquals(calls.length, 0);
  });
Deno.test("targeted claim retains role and project authorization before RPC", async () => {
  for (const [role, projects] of [
    ["pm", ["Battuta"]],
    ["worker", ["Other"]],
  ] as const) {
    const { send, calls } = setup(role);
    assertEquals((await send({ operation: "claim", projects, task_id: row.id })).status, 403);
    assertEquals(calls.length, 0);
  }
});
Deno.test("targeted claim rejects an unexpected task response", async () => {
  const response = await setup().send({
    operation: "claim",
    projects: ["Battuta"],
    task_id: "22345678-1234-4234-8234-123456789abc",
  });
  assertEquals(response.status, 500);
});
Deno.test("PostgREST's null composite claim is exposed as JSON null", async () => {
  const empty = Object.fromEntries(Object.keys(row).map((key) => [key, null]));
  const response = await setup("worker", empty).send({ operation: "claim", projects: ["Battuta"] });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), null);
});
for (const stored of [{ ...row, project: "Other" }, { ...row, claimed_by: "other" }, null])
  Deno.test(
    `bind rejects inaccessible stored task ${JSON.stringify(stored?.claimed_by)}/${JSON.stringify(stored?.project)}`,
    async () => {
      const { send, calls, state } = setup();
      state.stored = stored;
      assertEquals((await send(bind)).status, 403);
      assertEquals(calls.length, 1);
    },
  );
for (const [code, expected] of [
  ["PT403", 403],
  ["PT409", 409],
  ["23505", 409],
  ["22023", 400],
  ["23514", 400],
  ["XX000", 500],
] as const)
  Deno.test(`RPC ${code} maps to redacted HTTP ${expected}`, async () => {
    const response = await setup("worker", null, code).send({
      operation: "claim",
      projects: ["Battuta"],
    });
    assertEquals(response.status, expected);
    const body = await response.json();
    assertEquals(JSON.stringify(body).includes("private detail"), false);
  });
Deno.test("finalization rejects malformed reports before privileged mutation", async () => {
  const { send, calls } = setup();
  assertEquals((await send({ operation: "finalize", task_id: row.id, report: {} })).status, 400);
  assertEquals(
    calls.map((call) => call.name),
    ["task_pool_get_owned"],
  );
});
Deno.test("finalization derives owner and sends only the report to transactional RPC", async () => {
  const { send, calls } = setup();
  assertEquals((await send({ operation: "finalize", task_id: row.id, report })).status, 200);
  assertEquals(calls[1], {
    name: "task_pool_finalize",
    args: { p_worker_id: "host", p_task_id: row.id, p_report: report },
  });
});
Deno.test("HTTP method, bearer and malformed JSON are rejected", async () => {
  const { handler, send } = setup();
  assertEquals((await handler(new Request("http://local"))).status, 405);
  assertEquals((await send({ operation: "list_owned" }, "")).status, 401);
  assertEquals((await send({ operation: "list_owned", role: "worker" })).status, 400);
  assertEquals(
    (
      await handler(
        new Request("http://local", {
          method: "POST",
          headers: { authorization: "Bearer token" },
          body: "{",
        }),
      )
    ).status,
    400,
  );
});
Deno.test("owned pages preserve exact microseconds across the next cursor", async () => {
  const { send, state, calls } = setup(
    "worker",
    Array.from({ length: 101 }, (_, i) => ({
      ...row,
      id: `12345678-1234-4234-8234-${i.toString(16).padStart(12, "0")}`,
      created_at: "2026-10-07T00:00:00.123456+00:00",
    })),
  );
  const response = await send({ operation: "list_owned" });
  assertEquals(response.status, 200);
  const page = await response.json();
  assertEquals(page.tasks.length, 100);
  state.data = [];
  assertEquals((await send({ operation: "list_owned", cursor: page.next })).status, 200);
  assertEquals(calls[1].args.p_after_created_at, "2026-10-07T00:00:00.123456+00:00");
  assertEquals(calls[1].args.p_limit, 101);
});
Deno.test("owned pages revalidate current project grants", async () => {
  assertEquals(
    (await setup("worker", [{ ...row, project: "Other" }]).send({ operation: "list_owned" }))
      .status,
    403,
  );
});
Deno.test("oversized HTTP bodies are rejected before RPC", async () => {
  const { send, calls } = setup();
  assertEquals((await send({ padding: "x".repeat(140000) })).status, 400);
  assertEquals(calls.length, 0);
});
for (const [operation, data] of [
  ["claim", { id: "bad" }],
  ["list_owned", null],
] as const)
  Deno.test(`malformed ${operation} RPC results fail without leaking data`, async () => {
    const response = await setup("worker", data).send({
      operation,
      ...(operation === "claim" ? { projects: ["Battuta"] } : {}),
    });
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Task operation failed" });
  });
