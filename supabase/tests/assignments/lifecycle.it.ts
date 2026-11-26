import assert from "node:assert/strict";
import type postgres from "postgres";
import { applySettings, rpc, testSettings, withDatabaseTest } from "./helpers.ts";

async function claimed(sql: postgres.Sql, project: string, todos = ["Step"]) {
  const created = await rpc(sql, "assignment_create", [project, "Lifecycle", todos]);
  const claim = await rpc(sql, "assignment_claim", [project, created.assignment.id]);
  assert.equal(claim.ok, true);
  return claim;
}
const seconds = (later: string, earlier: string) =>
  (Date.parse(later) - Date.parse(earlier)) / 1000;
const leaseOf = async (sql: postgres.Sql, id: string) =>
  (await sql`select lease_expired_at from public.assignments where id=${id}`)[0].lease_expired_at;

Deno.test("claim and renew set the lease from lease.duration in the settings", () =>
  withDatabaseTest(async (sql, project) => {
    const claim = await claimed(sql, project);
    const { id, claimed_at } = claim.assignment;
    assert.ok(Math.abs(seconds(claim.assignment.lease_expired_at!, claimed_at!) - 600) < 1);
    await applySettings(sql, testSettings({ lease: 1200 }));
    try {
      const renewed = await rpc(sql, "assignment_renew", [project, id, claimed_at]);
      assert.equal(renewed.ok, true);
      const now = (await sql`select now() as now`)[0].now as Date;
      assert.ok(
        Math.abs(seconds(renewed.assignment.lease_expired_at!, now.toISOString()) - 1200) < 2,
      );
    } finally {
      await applySettings(sql);
    }
  }),
);

Deno.test("renew is claim-checked and leaves updated_at and availability alone", () =>
  withDatabaseTest(async (sql, project) => {
    const claim = await claimed(sql, project);
    const { id, claimed_at, updated_at } = claim.assignment;
    const revision = async () =>
      (await sql`select revision from public.assignment_availability`)[0].revision;
    const before = await revision();
    assert.equal(
      (await rpc(sql, "assignment_renew", [project, id, "2026-01-01T00:00:00Z"])).code,
      "stale_claim",
    );
    assert.equal(
      (await rpc(sql, "assignment_renew", [project, id, claimed_at, "worker-b"])).code,
      "stale_claim",
    );
    const renewed = await rpc(sql, "assignment_renew", [project, id, claimed_at]);
    assert.equal(renewed.ok, true);
    assert.equal(renewed.assignment.updated_at, updated_at);
    assert.equal(await revision(), before);
    await sql`update public.assignments set lease_expired_at=now()-interval '1 second' where id=${id}`;
    assert.equal(
      (await rpc(sql, "assignment_renew", [project, id, claimed_at])).code,
      "stale_claim",
    );
  }),
);

Deno.test("block, blocked report, finish and reactivate clear the lease", () =>
  withDatabaseTest(async (sql, project) => {
    const blocked = await claimed(sql, project);
    await rpc(sql, "assignment_block", [
      project,
      blocked.assignment.id,
      blocked.assignment.claimed_at,
      "Stuck",
    ]);
    assert.equal(await leaseOf(sql, blocked.assignment.id), null);
    await rpc(sql, "assignment_update_todo", [
      project,
      blocked.assignment.id,
      1,
      (await rpc(sql, "assignment_get", [project, blocked.assignment.id])).todos[0].updated_at,
      null,
      "cancelled",
    ]);
    await rpc(sql, "assignment_append_todos", [project, blocked.assignment.id, ["Again"]]);
    await rpc(sql, "assignment_reactivate", [project, blocked.assignment.id]);
    assert.equal(await leaseOf(sql, blocked.assignment.id), null);

    const reported = await claimed(sql, project);
    const r = reported.assignment;
    const started = await rpc(sql, "assignment_start_todo", [
      project,
      r.id,
      r.claimed_at,
      1,
      reported.todos[0].updated_at,
    ]);
    await rpc(sql, "assignment_record_todo_result", [
      project,
      r.id,
      r.claimed_at,
      1,
      started.todo.updated_at,
      "blocked",
      "No",
      [],
      "Need input",
    ]);
    assert.equal(await leaseOf(sql, r.id), null);

    const done = await claimed(sql, project);
    const d = done.assignment;
    const s = await rpc(sql, "assignment_start_todo", [
      project,
      d.id,
      d.claimed_at,
      1,
      done.todos[0].updated_at,
    ]);
    await rpc(sql, "assignment_record_todo_result", [
      project,
      d.id,
      d.claimed_at,
      1,
      s.todo.updated_at,
      "completed",
      "Done",
      [],
    ]);
    assert.equal((await rpc(sql, "assignment_finish", [project, d.id, d.claimed_at])).ok, true);
    assert.equal(await leaseOf(sql, d.id), null);
  }),
);

Deno.test("claim refuses until settings exist", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Lifecycle", ["Step"]]);
    await sql`delete from public.assignment_settings`;
    try {
      assert.equal(
        (await rpc(sql, "assignment_claim", [project, created.assignment.id])).code,
        "not_configured",
      );
      assert.equal(
        (await sql`select public.assignment_settings_get() as r`)[0].r.code,
        "not_configured",
      );
    } finally {
      await applySettings(sql);
    }
    assert.equal(
      (await sql`select public.assignment_settings_get() as r`)[0].r.settings.lease.duration,
      600,
    );
  }),
);

Deno.test("settings bounds are enforced and leave the row unchanged", () =>
  withDatabaseTest(async (sql) => {
    for (const bad of [
      testSettings({ heartbeat: 600 }),
      testSettings({ lease: 0, heartbeat: 0 }),
    ]) {
      await assert.rejects(applySettings(sql, bad));
    }
    assert.equal(
      (await sql`select value from public.assignment_settings`)[0].value.lease.duration,
      600,
    );
  }),
);

// Agent mail's strict content contract (agent-mail/content.ts), declared again here: Deno cannot load that package.
// A row outside it fails the reader's whole page, so every cron-written row must satisfy it.
const contentKeys = [
  "project",
  "ticket",
  "objective",
  "body",
  "requirements",
  "result",
  "related_messages",
];
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length >= 1 && value.length <= max && /\S/.test(value);
function assertMailContract(row: Record<string, unknown>) {
  assert.ok(["chat", "chase"].includes(row.message_type as string));
  assert.ok(["queue", "steer"].includes(row.delivery as string));
  const content = row.content as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(content).filter((key) => !contentKeys.includes(key)),
    [],
    "only contract keys",
  );
  assert.ok(text(content.project, 200), "project");
  assert.ok(text(content.objective, 2000), "objective");
  if ("body" in content) assert.ok(text(content.body, 4000), "body");
  if ("requirements" in content) {
    const requirements = content.requirements as unknown[];
    assert.ok(Array.isArray(requirements) && requirements.length <= 30);
    for (const requirement of requirements) assert.ok(text(requirement, 4000), "requirement");
    assert.notEqual(row.response_due, null, "requirements need a reply due");
  }
  if ("result" in content) {
    const result = content.result as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(result).filter((key) => !["state", "checks", "blocker"].includes(key)),
      [],
    );
    assert.ok(["in_progress", "blocked", "complete"].includes(result.state as string));
    assert.ok(Array.isArray(result.checks));
    if (result.state === "blocked") assert.ok(text(result.blocker, 4000), "blocker");
  }
}

const worker = () => `w-${crypto.randomUUID().slice(0, 8)}`;
async function claimedBy(sql: postgres.Sql, project: string, by: string) {
  const created = await rpc(sql, "assignment_create", [project, "Lifecycle", ["Step"]]);
  const claim = await rpc(sql, "assignment_claim", [
    project,
    created.assignment.id,
    by,
    ["research"],
  ]);
  assert.equal(claim.ok, true);
  return claim.assignment;
}
const scan = (sql: postgres.Sql) => sql`select public.assignment_lifecycle_scan()`;
const lapse = (sql: postgres.Sql, id: string) =>
  sql`update public.assignments set lease_expired_at=now()-interval '1 second' where id=${id}`;
const mail = (sql: postgres.Sql, by: string) =>
  sql`select * from public.agent_messages where sender=${by} or recipient=${by} order by created_at`;
const store = (
  sql: postgres.Sql,
  from: string,
  to: string,
  content: Record<string, unknown>,
  type = "chat",
) =>
  sql`select public.agent_mail_store(${from}, ${to}, ${crypto.randomUUID()}::uuid,
    ${type}::public.agent_message_type, ${sql.json(content as postgres.JSONValue)},
    ${"requirements" in content ? 20 : null}::integer, null, 'queue')`;
// Move the claim, its TODO writes and its mail an hour back together, so the worker looks silent.
async function silence(sql: postgres.Sql, id: string, by: string) {
  await sql`update public.assignments set claimed_at=claimed_at-interval '1 hour' where id=${id}`;
  await sql`update public.todos set updated_at=updated_at-interval '1 hour' where assignment_id=${id}`;
  await sql`update public.agent_messages set created_at=created_at-interval '1 hour',
    response_due=response_due-interval '1 hour' where sender=${by} or recipient=${by}`;
}
const progressRequests = async (sql: postgres.Sql, by: string) =>
  (await mail(sql, by)).filter(
    (row) => row.sender === "manager" && row.recipient === by && "requirements" in row.content,
  );

Deno.test("expiry blocks only lapsed in_process rows and mails the Manager once", () =>
  withDatabaseTest(async (sql, project) => {
    const by = worker();
    const lapsed = await claimedBy(sql, project, by);
    const live = await claimedBy(sql, project, worker());
    await lapse(sql, lapsed.id);
    await scan(sql);
    const detail = await rpc(sql, "assignment_get", [project, lapsed.id]);
    assert.equal(detail.assignment.status, "blocked");
    assert.equal(detail.assignment.lease_expired_at, null);
    assert.equal(detail.todos[0].status, "todo");
    assert.equal(
      (await rpc(sql, "assignment_get", [project, live.id])).assignment.status,
      "in_process",
    );
    const [conversation] =
      await sql`select claim_conversation_id from public.assignments where id=${lapsed.id}`;
    const notices = await mail(sql, by);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].recipient, "manager");
    assert.equal(notices[0].conversation_id, conversation.claim_conversation_id);
    assert.equal(notices[0].content.result.state, "blocked");
    assert.match(notices[0].content.objective + notices[0].content.body, new RegExp(lapsed.id));
    await scan(sql);
    assert.equal((await mail(sql, by)).length, 1);
  }),
);

Deno.test("a worker block that wins the race leaves no expiry notice", () =>
  withDatabaseTest(async (sql, project) => {
    const by = worker();
    const row = await claimedBy(sql, project, by);
    await lapse(sql, row.id);
    assert.equal(
      (await rpc(sql, "assignment_block", [project, row.id, row.claimed_at, "Worker stopped", by]))
        .ok,
      true,
    );
    await scan(sql);
    assert.equal((await mail(sql, by)).length, 0);
    assert.equal(
      (await rpc(sql, "assignment_get", [project, row.id])).assignment.blocker,
      "Worker stopped",
    );
  }),
);

Deno.test("one failing row does not stop the others from expiring", () =>
  withDatabaseTest(async (sql, project) => {
    const badWorker = worker(),
      goodWorker = worker();
    const bad = await claimedBy(sql, project, badWorker);
    const good = await claimedBy(sql, project, goodWorker);
    await sql`update public.assignments set claim_conversation_id=null where id=${bad.id}`;
    await lapse(sql, bad.id);
    await lapse(sql, good.id);
    await scan(sql);
    assert.equal(
      (await rpc(sql, "assignment_get", [project, good.id])).assignment.status,
      "blocked",
    );
    assert.equal((await mail(sql, goodWorker)).length, 1);
    assert.equal(
      (await rpc(sql, "assignment_get", [project, bad.id])).assignment.status,
      "in_process",
    );
    assert.equal((await mail(sql, badWorker)).length, 0);
  }),
);

Deno.test("a silent worker is asked for progress once per window", () =>
  withDatabaseTest(async (sql, project) => {
    const by = worker();
    const row = await claimedBy(sql, project, by);
    await scan(sql);
    assert.equal((await progressRequests(sql, by)).length, 0, "not yet silent");
    await silence(sql, row.id, by);
    await scan(sql);
    const [request] = await progressRequests(sql, by);
    assert.equal(request.delivery, "steer");
    assert.notEqual(request.response_due, null);
    assert.ok(Array.isArray(request.content.requirements));
    await scan(sql);
    assert.equal((await progressRequests(sql, by)).length, 1, "the request resets the clock");
  }),
);

Deno.test("any recent TODO write or mail in either direction counts as a report", async (t) => {
  const recent: Record<string, (sql: postgres.Sql, id: string, by: string) => Promise<unknown>> = {
    "TODO write": (sql, id) =>
      sql`update public.todos set updated_at=now() where assignment_id=${id}`,
    "worker mail": (sql, _id, by) =>
      store(sql, by, "manager", { project: "p", objective: "Status" }),
    "Manager mail": (sql, _id, by) =>
      store(sql, "manager", by, { project: "p", objective: "Go on" }),
  };
  for (const [name, report] of Object.entries(recent)) {
    await t.step(name, () =>
      withDatabaseTest(async (sql, project) => {
        const by = worker();
        const row = await claimedBy(sql, project, by);
        await silence(sql, row.id, by);
        await report(sql, row.id, by);
        await scan(sql);
        assert.equal((await progressRequests(sql, by)).length, 0);
      }),
    );
  }
});

Deno.test("a worker waiting on an unanswered question is not asked for progress", () =>
  withDatabaseTest(async (sql, project) => {
    const by = worker();
    const row = await claimedBy(sql, project, by);
    await store(sql, by, "manager", { project, objective: "Which API?", requirements: ["Answer"] });
    await store(sql, by, "manager", { project, objective: "Still waiting" }, "chase");
    await silence(sql, row.id, by);
    await scan(sql);
    assert.equal((await progressRequests(sql, by)).length, 0);
  }),
);

Deno.test("a lapsed lease is expired, never asked for progress", () =>
  withDatabaseTest(async (sql, project) => {
    const by = worker();
    const row = await claimedBy(sql, project, by);
    await silence(sql, row.id, by);
    await lapse(sql, row.id);
    await scan(sql);
    assert.deepEqual(
      (await mail(sql, by)).map((m) => m.recipient),
      ["manager"],
    );
  }),
);

Deno.test("cron mail matches the agent-mail content contract", () =>
  withDatabaseTest(async (sql, project) => {
    const expired = worker(),
      silent = worker();
    const a = await claimedBy(sql, project, expired);
    const b = await claimedBy(sql, project, silent);
    await lapse(sql, a.id);
    await silence(sql, b.id, silent);
    await scan(sql);
    const rows = [...(await mail(sql, expired)), ...(await mail(sql, silent))];
    assert.equal(rows.length, 2);
    for (const row of rows) assertMailContract(row);
  }),
);

Deno.test("the scan job is scheduled once at check_interval", () =>
  withDatabaseTest(async (sql) => {
    await applySettings(sql);
    await applySettings(sql);
    const jobs = await sql`select schedule from cron.job where jobname='assignment-lifecycle-scan'`;
    assert.deepEqual(
      jobs.map((job) => job.schedule),
      ["*/1 * * * *"],
    );
  }),
);
