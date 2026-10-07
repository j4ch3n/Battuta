import {
  createClient,
  FunctionsHttpError,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TaskClient } from "../client.ts";
import type { Principal, TaskRow } from "../../supabase/functions/_shared/task-contracts.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanupOwned } from "./cleanup.ts";

const url = process.env.SUPABASE_URL!;
const adminKey = process.env.SUPABASE_SECRET_KEY!;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
if (
  url !== "http://127.0.0.1:55321" ||
  process.env.SUPABASE_TEST_DB_CONTAINER !== "supabase_db_battuta-check"
)
  throw new Error("Task integration requires the isolated local Supabase runner");
const admin = createClient(url, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const prefix = `task-test-${crypto.randomUUID()}`;
const project = `${prefix}-p`;
const users: string[] = [];
const clients: SupabaseClient[] = [];
let pm: SupabaseClient,
  tl: SupabaseClient,
  worker: SupabaseClient,
  other: SupabaseClient,
  spoof: SupabaseClient;
let peer: SupabaseClient;
const instruction = {
  schema_version: 1 as const,
  summary: "Parser task",
  objective: "Parse safely",
  scope: ["Parser"],
  constraints: [],
  inputs: [],
  acceptance_criteria: [{ id: "c1", expectation: "Pass tests" }],
  deliverables: ["Tests"],
};
const failed = {
  schema_version: 1 as const,
  state: "failed" as const,
  summary: "Cannot prepare",
  checks: [],
  artifacts: [],
  failure: "Checkout unavailable",
};
async function identity(principal: Principal | null) {
  const email = `${crypto.randomUUID()}@task-test.local`;
  const password = `Local-${crypto.randomUUID()}!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: principal ? { battuta: principal } : {},
    user_metadata: { battuta: { role: "pm", projects: [project] } },
  });
  if (created.error) throw created.error;
  users.push(created.data.user.id);
  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clients.push(client);
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  await client.realtime.setAuth(login.data.session.access_token);
  return client;
}
async function request(client: SupabaseClient, body: Record<string, unknown>) {
  return (await client.functions.invoke<unknown>("task-pool", { body })) as {
    data: unknown;
    error: unknown;
  };
}
function rejection(error: unknown): Response {
  if (!(error instanceof FunctionsHttpError) || !(error.context instanceof Response))
    throw new Error("Expected HTTP rejection");
  return error.context;
}
async function status(client: SupabaseClient, body: Record<string, unknown>, expected: number) {
  const { error } = await request(client, body);
  expect(rejection(error).status).toBe(expected);
}
async function delegate(key: string, client = pm) {
  return new TaskClient(client).delegate({
    key: `${prefix}-${key}`,
    project,
    ticket_id: "FIS-40",
    instruction,
  });
}
beforeAll(async () => {
  pm = await identity({ role: "pm", projects: [project] });
  tl = await identity({ role: "tl", projects: [project] });
  worker = await identity({ role: "worker", worker_id: `${prefix}-host`, projects: [project] });
  other = await identity({
    role: "worker",
    worker_id: `${prefix}-other`,
    projects: [`${project}-other`],
  });
  spoof = await identity(null);
  peer = await identity({ role: "worker", worker_id: `${prefix}-peer`, projects: [project] });
});
afterAll(async () => {
  await cleanupOwned([
    ...clients.map((client) => () => client.removeAllChannels()),
    async () => {
      const tasks = await admin
        .from("tasks_pool")
        .select("result_message_ref")
        .eq("project", project)
        .returns<Pick<TaskRow, "result_message_ref">[]>();
      if (tasks.error) throw tasks.error;
      await cleanupOwned(
        (tasks.data ?? []).flatMap((task) =>
          task.result_message_ref
            ? [
                async () =>
                  admin
                    .from("agent_messages")
                    .delete()
                    .eq("conversation_id", task.result_message_ref!.conversation_id),
              ]
            : [],
        ),
      );
    },
    async () => admin.from("tasks_pool").delete().eq("project", project),
    ...users.map((id) => () => admin.auth.admin.deleteUser(id)),
  ]);
});
it("real Auth attribution, exact delegation retries, role/project denials and public DB isolation", async () => {
  const first = await delegate("one");
  expect(first.delegator_role).toBe("pm");
  expect(await delegate("one")).toEqual(first);
  expect((await delegate("tl", tl)).delegator_role).toBe("tl");
  await status(tl, { operation: "delegate", key: first.key, project, instruction }, 409);
  await status(spoof, { operation: "delegate", key: `${prefix}-spoof`, project, instruction }, 403);
  await status(
    worker,
    { operation: "delegate", key: `${prefix}-worker`, project, instruction },
    403,
  );
  await status(pm, { operation: "claim", projects: [project] }, 403);
  await status(other, { operation: "claim", projects: [project] }, 403);
  const denied = await worker.from("tasks_pool").select("*");
  expect(denied.error).not.toBeNull();
  expect(
    (await worker.rpc("task_pool_claim", { p_worker_id: "spoof", p_projects: [project] })).error,
  ).not.toBeNull();
  const response = await fetch(`${url}/functions/v1/task-pool`, {
    method: "POST",
    headers: {
      apikey: publicKey,
      authorization: `Bearer ${adminKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ operation: "list_owned" }),
  });
  expect(response.status).toBe(401);
  for (const token of ["invalid-token", "", process.env.SUPABASE_SERVICE_ROLE_KEY!]) {
    const response = await fetch(`${url}/functions/v1/task-pool`, {
      method: "POST",
      headers: {
        apikey: publicKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "list_owned" }),
    });
    expect(response.status).toBe(401);
  }
});
it("concurrent claims are unique; binding, pre-session failure and mail finalization are immutable", async () => {
  const client = new TaskClient(worker);
  const claimed = await Promise.all([client.claim([project]), client.claim([project])]);
  expect(claimed.every(Boolean)).toBe(true);
  expect(new Set(claimed.map((t) => t!.id)).size).toBe(2);
  const [a, b] = claimed as [TaskRow, TaskRow];
  await status(other, { operation: "bind", task_id: a.id, session_id: "other" }, 403);
  const bound = await client.bind(a.id, `${prefix}-session`);
  expect(await client.bind(a.id, `${prefix}-session`)).toEqual(bound);
  await status(peer, { operation: "bind", task_id: a.id, session_id: "spoof" }, 403);
  await status(peer, { operation: "finalize", task_id: a.id, report: failed }, 403);
  await status(worker, { operation: "bind", task_id: b.id, session_id: `${prefix}-session` }, 409);
  await status(worker, { operation: "bind", task_id: a.id, session_id: "different" }, 409);
  const completed = {
    ...failed,
    state: "completed" as const,
    failure: null,
    artifacts: [{ locator: "git:local", description: "Parser patch" }],
    checks: [
      {
        criterion_id: "c1",
        result: "passed" as const,
        evidence: [{ locator: "tests", description: "Passed" }],
      },
    ],
  };
  await status(worker, { operation: "finalize", task_id: b.id, report: completed }, 400);
  const terminal = await client.finalize(a.id, completed);
  expect(await client.finalize(a.id, completed)).toEqual(terminal);
  expect(terminal.result_message_ref!.conversation_id).not.toBe(a.id);
  await status(worker, { operation: "finalize", task_id: a.id, report: failed }, 409);
  expect((await client.finalize(b.id, failed)).opencode_session_id).toBeNull();
  const mail = await admin
    .from("agent_messages")
    .select("*")
    .eq("conversation_id", terminal.result_message_ref!.conversation_id)
    .returns<{ recipient: string; sender: string; content: unknown }[]>();
  expect(mail.data).toHaveLength(1);
  expect(mail.data![0].recipient).toBe(a.delegator_role);
  expect(mail.data![0].sender).toBe(`worker.${a.claimed_by}`);
  expect(mail.data![0].content).toEqual({
    schema_version: 1,
    kind: "worker_result",
    state: "completed",
    text: `${project} — Parser task\nCannot prepare`,
    references: [{ locator: "git:local", note: "Parser patch" }],
  });
  expect(await client.listOwned()).toEqual({ tasks: [], next: null });
});
it("two authenticated workers racing for one queued row yield one sticky owner", async () => {
  const task = await delegate("contested");
  const contenders = [new TaskClient(worker), new TaskClient(peer)];
  const raw = await Promise.all(
    [worker, peer].map((client) => request(client, { operation: "claim", projects: [project] })),
  );
  expect(raw.map((result) => result.error)).toEqual([null, null]);
  const result = raw.map((result) => result.data as TaskRow | null);
  expect(result, JSON.stringify(result)).toContain(null);
  expect(result.filter((task) => task === null)).toHaveLength(1);
  expect(result.filter(Boolean)).toHaveLength(1);
  const winner = result.findIndex(Boolean);
  expect(result[winner]!.id).toBe(task.id);
  expect((await contenders[winner].finalize(task.id, failed)).claimed_by).toBe(
    result[winner]!.claimed_by,
  );
  expect(await new TaskClient(worker).claim([project])).toBeNull();
});
it("private queued broadcast carries project only and unauthorized private subscribers are denied", async () => {
  const received: unknown[] = [];
  const channel = worker
    .channel(`task-pool:${project}`, { config: { private: true, broadcast: { ack: true } } })
    .on("broadcast", { event: "queued" }, (message) => received.push(message.payload));
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((state, error) => {
      if (state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve();
      if (
        state === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        state === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
      )
        reject(error ?? new Error(state));
    });
  });
  const forbidden = other.channel(`task-pool:${project}`, { config: { private: true } });
  const state = await new Promise<string>((resolve) =>
    forbidden.subscribe((state) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(state)) resolve(state);
    }),
  );
  expect(state).toBe("CHANNEL_ERROR");
  await delegate("broadcast");
  try {
    await expect.poll(() => received.length, { timeout: 10000 }).toBe(1);
    const payload = received[0] as { project: string; id: string };
    expect(payload.project).toBe(project);
    // Realtime's transport adds its own message UUID, not a task/execution identifier.
    expect(Object.keys(payload).sort()).toEqual(["id", "project"]);
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
    const session = await worker.auth.getSession();
    const deniedSend = await fetch(channel.broadcastEndpointURL, {
      method: "POST",
      headers: {
        apikey: publicKey,
        authorization: `Bearer ${session.data.session!.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `task-pool:${project}`,
            event: "queued",
            payload: { project: "spoof" },
            private: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    const sendDetail = await deniedSend.text();
    // This server's batch endpoint acknowledges valid batches with 202 while
    // dropping private messages whose RLS write authorization is false.
    expect(deniedSend.status, sendDetail).toBe(202);
    await delegate("broadcast-barrier");
    await expect
      .poll(() => received.map((message) => (message as { project: string }).project), {
        timeout: 10000,
      })
      .toEqual([project, project]);
  } finally {
    await worker.removeChannel(channel);
    await other.removeChannel(forbidden);
    for (let i = 0; i < 2; i++) {
      const claimed = await new TaskClient(worker).claim([project]);
      if (claimed) await new TaskClient(worker).finalize(claimed.id, failed);
    }
  }
});
it("owned tasks keyset paginate at 100 without lost equal-timestamp rows", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    key: `${prefix}-page-${i}`,
    project,
    delegator_role: "pm",
    instruction,
    claimed_by: `${prefix}-host`,
    claimed_at: "2026-10-07T00:00:00Z",
    created_at: "2026-10-07T00:00:00.123456Z",
  }));
  const inserted = await admin.from("tasks_pool").insert(rows);
  if (inserted.error) throw inserted.error;
  const client = new TaskClient(worker);
  const first = await client.listOwned();
  expect(first.tasks).toHaveLength(100);
  expect(first.next).not.toBeNull();
  const second = await client.listOwned(first.next!);
  expect(second.tasks).toHaveLength(1);
  expect(second.next).toBeNull();
  expect(new Set([...first.tasks, ...second.tasks].map((t) => t.id)).size).toBe(101);
  await status(worker, { operation: "list_owned", cursor: "bad" }, 400);
});
it("Edge and DB accept exactly 65536 compact UTF-8 bytes, rejecting one-byte overflow", async () => {
  const sized = {
    ...instruction,
    objective: "x",
    constraints: Array.from({ length: 16 }, () => "x".repeat(4000)),
  };
  const padding = 65536 - Buffer.byteLength(JSON.stringify(sized));
  sized.objective += "é".repeat(Math.floor(padding / 2)) + "x".repeat(padding % 2);
  expect(Buffer.byteLength(JSON.stringify(sized))).toBe(65536);
  const task = await new TaskClient(pm).delegate({
    key: `${prefix}-byte-boundary`,
    project,
    instruction: sized,
  });
  await status(
    pm,
    {
      operation: "delegate",
      key: `${prefix}-byte-overflow`,
      project,
      instruction: { ...sized, objective: `${sized.objective}x` },
    },
    400,
  );
  const claimed = await new TaskClient(worker).claim([project]);
  expect(claimed!.id).toBe(task.id);
  const sizedReport = {
    ...failed,
    summary: "x",
    artifacts: Array.from({ length: 16 }, () => ({
      locator: "tests",
      description: "x".repeat(4000),
    })),
  };
  const remaining = 65536 - Buffer.byteLength(JSON.stringify(sizedReport));
  sizedReport.summary += "é".repeat(Math.floor(remaining / 2)) + "x".repeat(remaining % 2);
  expect(Buffer.byteLength(JSON.stringify(sizedReport))).toBe(65536);
  await status(
    worker,
    {
      operation: "finalize",
      task_id: task.id,
      report: { ...sizedReport, summary: `${sizedReport.summary}x` },
    },
    400,
  );
  expect((await new TaskClient(worker).finalize(task.id, sizedReport)).terminal_report).toEqual(
    sizedReport,
  );
});
it("an Edge finalization error rolls back both the inserted mail and task report", async () => {
  // Explicitly scoped fault injection only in the isolated runner's test database.
  if (process.env.SUPABASE_TEST_DB_CONTAINER !== "supabase_db_battuta-check")
    throw new Error("Isolated test database required");
  const sql = async (query: string) =>
    promisify(execFile)("docker", [
      "exec",
      process.env.SUPABASE_TEST_DB_CONTAINER!,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ]);
  const delegated = await delegate("rollback");
  const claimed = await new TaskClient(worker).claim([project]);
  expect(claimed!.id).toBe(delegated.id);
  await sql(
    `create function public.task_test_reject_finish() returns trigger language plpgsql as $$ begin if new.id = '${delegated.id}'::uuid and new.terminal_report is not null then raise exception 'test-only failure after mail'; end if; return new; end $$; create trigger task_test_reject_finish before update on public.tasks_pool for each row execute function public.task_test_reject_finish();`,
  );
  const before = await admin
    .from("agent_messages")
    .select("id", { count: "exact" })
    .eq("sender", `worker.${claimed!.claimed_by}`);
  try {
    const result = await request(worker, {
      operation: "finalize",
      task_id: claimed!.id,
      report: failed,
    });
    const response = rejection(result.error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Task operation failed" });
    const stored = await admin
      .from("tasks_pool")
      .select("*")
      .eq("id", delegated.id)
      .returns<TaskRow[]>()
      .single();
    if (stored.error) throw stored.error;
    expect(stored.data.terminal_report).toBeNull();
    expect(stored.data.result_message_ref).toBeNull();
    const after = await admin
      .from("agent_messages")
      .select("id", { count: "exact" })
      .eq("sender", `worker.${claimed!.claimed_by}`);
    expect(after.count).toBe(before.count);
  } finally {
    await sql(
      "drop trigger task_test_reject_finish on public.tasks_pool; drop function public.task_test_reject_finish();",
    );
  }
  expect((await new TaskClient(worker).finalize(delegated.id, failed)).terminal_report).toEqual(
    failed,
  );
});
