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
