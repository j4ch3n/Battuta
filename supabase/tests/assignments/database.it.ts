import assert from "node:assert/strict";
import { rpc, withDatabaseTest } from "./helpers.ts";

Deno.test("create/read explicit project, short keys, and private mismatched targets", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [
      project,
      "Deliver result",
      "No publishing",
    ]);
    assert.equal(created.ok, true);
    assert.match(created.assignment.id, /^[0-9a-f]{8}$/);
    assert.equal(created.assignment.status, "active");
    const read = await rpc(sql, "assignment_get", [project, created.assignment.id]);
    assert.deepEqual(read.todos, []);
    assert.equal(read.assignment.constraints, "No publishing");
    assert.equal(
      (await rpc(sql, "assignment_get", [project + "-wrong", created.assignment.id])).code,
      "not_found",
    );
    for (const bad of ["", ".hidden", "a/b", "a\\b", "a\nb", "  "]) {
      assert.equal((await rpc(sql, "assignment_create", [bad, "Goal", ""])).code, "invalid_input");
    }
    for (const id of ["bad", crypto.randomUUID(), "ABCDEF12"]) {
      assert.equal((await rpc(sql, "assignment_get", [project, id])).code, "invalid_input");
    }
    assert.equal((await rpc(sql, "assignment_create", [project, " ", ""])).code, "invalid_input");
    assert.equal((await rpc(sql, "assignment_list", [project, "blocked"])).code, "invalid_input");
  }),
);

Deno.test("concurrent create has one active winner", () =>
  withDatabaseTest(async (sql, project) => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => rpc(sql, "assignment_create", [project, "Goal", ""])),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => r.code === "active_exists").length, 7);
    assert.equal(new Set(results.map((r) => r.assignment.id)).size, 1);
  }),
);

Deno.test("reads do not truncate at 1000 and have explicit stable order", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment } = await rpc(sql, "assignment_create", [project, "Large list", ""]);
    await sql`insert into public.todos (assignment_id, position, description) select ${assignment.id}, n, 'Step ' || n from generate_series(1001,1,-1) n`;
    const read = await rpc(sql, "assignment_get", [project, assignment.id]);
    assert.deepEqual(
      read.todos.map((t) => t.position),
      Array.from({ length: 1001 }, (_, i) => i + 1),
    );
    await sql`update public.assignments set created_at = '2026-01-01' where id = ${assignment.id}`;
    await sql`insert into public.assignments (id, project, goal, status, closed_at, created_at) select left(md5(${project} || n),8), ${project}, 'Historical', 'done', now(), '2026-01-01'::timestamptz from generate_series(1,1000) n`;
    const history = await rpc(sql, "assignment_list", [project, null]);
    assert.equal(history.assignments.length, 1001);
    assert.deepEqual(
      history.assignments.map((a) => a.id),
      history.assignments
        .map((a) => a.id)
        .sort()
        .reverse(),
    );
  }),
);

Deno.test("ID collision retries do not overwrite; exhaustion leaves no assignment", () =>
  withDatabaseTest(async (sql, project) => {
    const rollback = new Error("test rollback");
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx`insert into public.assignments(id,project,goal,status,closed_at) values ('1234abcd',${project},'Preserve','done',now())`;
        await tx`create temporary sequence assignment_test_ids`;
        await tx.unsafe(
          `create function pg_temp.assignment_test_uuid() returns uuid language sql as $$ select case when nextval('pg_temp.assignment_test_ids') = 1 then '1234abcd-0000-4000-8000-000000000000'::uuid else 'abcd1234-0000-4000-8000-000000000000'::uuid end $$`,
        );
        const [{ definition }] =
          await tx`select pg_get_functiondef('public.assignment_create(text,text,text)'::regprocedure) as definition`;
        // Only this transaction sees the replacement; rollback restores the real generator.
        await tx.unsafe(definition.replace("gen_random_uuid()", "pg_temp.assignment_test_uuid()"));
        assert.equal(
          (await rpc(tx, "assignment_create", [project, "Fresh", ""])).assignment.id,
          "abcd1234",
        );
        assert.equal(
          (await rpc(tx, "assignment_get", [project, "1234abcd"])).assignment.goal,
          "Preserve",
        );
        await tx`delete from public.assignments where project = ${project} and status = 'active'`;
        await tx.unsafe(
          `create or replace function pg_temp.assignment_test_uuid() returns uuid language sql as $$ select '1234abcd-0000-4000-8000-000000000000'::uuid $$`,
        );
        assert.equal(
          (await rpc(tx, "assignment_create", [project, "Never saved", ""])).code,
          "id_exhausted",
        );
        assert.equal((await rpc(tx, "assignment_list", [project, null])).assignments.length, 1);
        throw rollback;
      }),
      (error) => error === rollback,
    );
  }),
);
