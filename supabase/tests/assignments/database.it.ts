import assert from "node:assert/strict";
import { rpc, withDatabaseTest } from "./helpers.ts";

const blankText = [
  "\t",
  "\n",
  "\r\n",
  "\v",
  "\f",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2001",
  "\u2002",
  "\u2003",
  "\u2004",
  "\u2005",
  "\u2006",
  "\u2007",
  "\u2008",
  "\u2009",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
];

Deno.test("completion versus resurrection and append obey both serialized orderings", () =>
  withDatabaseTest(async (sql, project) => {
    for (const order of ["close-first-update", "update-first-close", "close-first-append"]) {
      const a = (await rpc(sql, "assignment_create", [project, "Race", ""])).assignment;
      const original = (await rpc(sql, "assignment_append_todos", [project, a.id, ["Step"]]))
        .todos[0];
      const item = (
        await rpc(sql, "assignment_update_todo", [
          project,
          a.id,
          1,
          original.updated_at,
          null,
          "done",
          null,
        ])
      ).todo;
      let pending: ReturnType<typeof rpc> | undefined;
      await sql.begin(async (tx) => {
        if (order === "update-first-close") {
          assert.equal(
            (
              await rpc(tx, "assignment_update_todo", [
                project,
                a.id,
                1,
                item.updated_at,
                null,
                "todo",
                null,
              ])
            ).ok,
            true,
          );
          pending = rpc(sql, "assignment_close", [project, a.id, "done"]);
        } else {
          assert.equal((await rpc(tx, "assignment_close", [project, a.id, "done"])).ok, true);
          pending =
            order === "close-first-append"
              ? rpc(sql, "assignment_append_todos", [project, a.id, ["Late"]])
              : rpc(sql, "assignment_update_todo", [
                  project,
                  a.id,
                  1,
                  item.updated_at,
                  null,
                  "todo",
                  null,
                ]);
        }
        const [{ pid }] = await tx`select pg_backend_pid() as pid`;
        for (let n = 0; n < 1000; n++) {
          const [{ blocked }] =
            await sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
          if (blocked) return;
        }
        throw new Error("Competing operation did not wait for the parent lock");
      });
      const result = await pending;
      const read = await rpc(sql, "assignment_get", [project, a.id]);
      if (order === "update-first-close") {
        assert.equal(result!.code, "unfinished_todos");
        assert.equal(read.assignment.status, "active");
        assert.equal(read.todos[0].status, "todo");
        await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
      } else {
        assert.equal(result!.code, "assignment_closed");
        assert.equal(read.assignment.status, "done");
        assert.equal(read.todos[0].status, "done");
      }
      assert.equal(read.todos.length, 1);
    }
  }),
);
Deno.test("direct RPC rejects every ECMAScript whitespace-only goal without creating records", () =>
  withDatabaseTest(async (sql, project) => {
    for (const goal of blankText) {
      assert.equal(
        (await rpc(sql, "assignment_create", [project, goal, ""])).code,
        "invalid_input",
      );
      assert.deepEqual((await rpc(sql, "assignment_list", [project, null])).assignments, []);
    }
  }),
);
Deno.test("direct RPC rejects whitespace-only project names consistently with MCP", () =>
  withDatabaseTest(async (sql) => {
    const rollback = new Error("test rollback");
    await assert.rejects(
      sql.begin(async (tx) => {
        for (const project of blankText) {
          assert.equal(
            (await rpc(tx, "assignment_create", [project, "Goal", ""])).code,
            "invalid_input",
          );
        }
        throw rollback;
      }),
      (error) => error === rollback,
    );
  }),
);
Deno.test("direct RPC rejects whitespace-only append batches atomically", () =>
  withDatabaseTest(async (sql, project) => {
    const a = (await rpc(sql, "assignment_create", [project, "Goal", ""])).assignment;
    for (const description of blankText) {
      assert.equal(
        (
          await rpc(sql, "assignment_append_todos", [
            project,
            a.id,
            ["Must not persist", description],
          ])
        ).code,
        "invalid_input",
      );
      assert.deepEqual((await rpc(sql, "assignment_get", [project, a.id])).todos, []);
    }
  }),
);
Deno.test("direct RPC rejects whitespace-only updates and table constraints protect reads", () =>
  withDatabaseTest(async (sql, project) => {
    const a = (await rpc(sql, "assignment_create", [project, "Goal", ""])).assignment;
    const before = (await rpc(sql, "assignment_append_todos", [project, a.id, ["Keep"]])).todos[0];
    for (const description of blankText) {
      assert.equal(
        (
          await rpc(sql, "assignment_update_todo", [
            project,
            a.id,
            1,
            before.updated_at,
            description,
            null,
            null,
          ])
        ).code,
        "invalid_input",
      );
      assert.deepEqual((await rpc(sql, "assignment_get", [project, a.id])).todos, [before]);
    }
    await assert.rejects(sql`update public.assignments set goal = ${"\t\n"} where id = ${a.id}`, {
      code: "23514",
    });
    await assert.rejects(
      sql`update public.todos set description = ${"\ufeff"} where assignment_id = ${a.id}`,
      { code: "23514" },
    );
  }),
);

Deno.test(
  "two registered project names keep independent active assignments and shared access",
  () =>
    withDatabaseTest(async (sql, project) => {
      await withDatabaseTest(async (other, secondProject) => {
        const first = (await rpc(sql, "assignment_create", [project, "First project", ""]))
          .assignment;
        const second = (
          await rpc(other, "assignment_create", [secondProject, "Second project", ""])
        ).assignment;
        assert.equal(first.status, "active");
        assert.equal(second.status, "active");
        assert.notEqual(first.id, second.id);
        assert.equal(
          (await rpc(other, "assignment_get", [project, first.id])).assignment.goal,
          "First project",
        );
        assert.equal((await rpc(sql, "assignment_get", [project, second.id])).code, "not_found");
        assert.deepEqual(
          (await rpc(sql, "assignment_list", [project, "active"])).assignments.map((a) => a.id),
          [first.id],
        );
      });
    }),
);

Deno.test("append/update in place, out of order, with stale-write protection", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
    const appended = await rpc(sql, "assignment_append_todos", [
      project,
      a.id,
      ["One", "Two", "Three"],
    ]);
    assert.deepEqual(
      appended.todos.map((t) => t.position),
      [1, 2, 3],
    );
    let item = appended.todos[2];
    const old = item.updated_at;
    for (const status of ["done", "todo", "in_progress", "cancelled"]) {
      item = (
        await rpc(sql, "assignment_update_todo", [
          project,
          a.id,
          3,
          item.updated_at,
          "Edited",
          status,
          "Evidence",
        ])
      ).todo;
      assert.equal(item.status, status);
      assert.equal(item.position, 3);
    }
    const stale = await rpc(sql, "assignment_update_todo", [
      project,
      a.id,
      3,
      old,
      null,
      "todo",
      null,
    ]);
    assert.equal(stale.code, "stale_update");
    assert.equal(stale.todo.status, "cancelled");
    for (const patch of [
      [0, item.updated_at, null, "done", null],
      [4, item.updated_at, null, "done", null],
      [3, item.updated_at, null, null, null],
      [3, item.updated_at, " ", null, null],
      [3, item.updated_at, null, "blocked", null],
    ]) {
      assert.equal((await rpc(sql, "assignment_update_todo", [project, a.id, ...patch])).ok, false);
    }
    assert.equal(
      (await rpc(sql, "assignment_append_todos", [project, a.id, ["Four", " "]])).code,
      "invalid_input",
    );
    assert.deepEqual(
      (await rpc(sql, "assignment_get", [project, a.id])).todos.map((t) => t.position),
      [1, 2, 3],
    );
  }),
);

Deno.test(
  "closure reports unfinished items, cancellation preserves evidence, terminal retries are safe",
  () =>
    withDatabaseTest(async (sql, project) => {
      const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
      const items = (await rpc(sql, "assignment_append_todos", [project, a.id, ["One", "Two"]]))
        .todos;
      await rpc(sql, "assignment_update_todo", [
        project,
        a.id,
        2,
        items[1].updated_at,
        null,
        "done",
        "Verified",
      ]);
      const refusal = await rpc(sql, "assignment_close", [project, a.id, "done"]);
      assert.equal(refusal.code, "unfinished_todos");
      assert.deepEqual(
        refusal.unfinished.map((t) => [t.position, t.status]),
        [[1, "todo"]],
      );
      assert.equal(
        (await rpc(sql, "assignment_get", [project, a.id])).assignment.updated_at,
        a.updated_at,
      );
      const closed = await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
      assert.deepEqual(
        (await rpc(sql, "assignment_get", [project, a.id])).todos.map((t) => [
          t.position,
          t.status,
          t.outcome,
        ]),
        [
          [1, "todo", ""],
          [2, "done", "Verified"],
        ],
      );
      assert.deepEqual(
        (await rpc(sql, "assignment_close", [project, a.id, "cancelled"])).assignment,
        closed.assignment,
      );
      assert.equal(
        (await rpc(sql, "assignment_close", [project, a.id, "done"])).code,
        "assignment_closed",
      );
      assert.equal(
        (await rpc(sql, "assignment_append_todos", [project, a.id, ["Later"]])).code,
        "assignment_closed",
      );
      assert.equal(
        (
          await rpc(sql, "assignment_update_todo", [
            project,
            a.id,
            1,
            items[0].updated_at,
            null,
            "done",
            null,
          ])
        ).code,
        "assignment_closed",
      );
      const next = (await rpc(sql, "assignment_create", [project, "Next", ""])).assignment;
      assert.equal(
        (await rpc(sql, "assignment_close", [project, next.id, "done"])).assignment.status,
        "done",
      );
    }),
);

Deno.test("concurrent appends allocate unique consecutive positions", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        rpc(sql, "assignment_append_todos", [project, a.id, ["A", "B"]]),
      ),
    );
    assert.deepEqual(
      (await rpc(sql, "assignment_get", [project, a.id])).todos.map((t) => t.position),
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  }),
);

Deno.test("microsecond tokens advance within one transaction", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
    await sql.begin(async (tx) => {
      const item = (await rpc(tx, "assignment_append_todos", [project, a.id, ["A"]])).todos[0];
      const updated = (
        await rpc(tx, "assignment_update_todo", [
          project,
          a.id,
          1,
          item.updated_at,
          null,
          "done",
          null,
        ])
      ).todo;
      assert.notEqual(updated.updated_at, item.updated_at);
      const stale = await rpc(tx, "assignment_update_todo", [
        project,
        a.id,
        1,
        item.updated_at,
        null,
        "todo",
        null,
      ]);
      assert.equal(stale.code, "stale_update");
      assert.equal(stale.todo.updated_at, updated.updated_at);
      assert.equal((await rpc(tx, "assignment_close", [project, a.id, "done"])).ok, true);
    });
  }),
);

Deno.test("note preparation returns shared safe path, conflicts, and frozen guidance state", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
    assert.equal(
      (await rpc(sql, "assignment_locate_notes", [project, a.id])).code,
      "notes_unprepared",
    );
    for (const root of ["~/root", "relative", "/a/../b", "/a/./b", "/a//b", "/a\\b", "/a\nb", ""]) {
      assert.equal(
        (await rpc(sql, "assignment_prepare_notes", [project, a.id, root])).code,
        "invalid_input",
      );
    }
    const notes = await rpc(sql, "assignment_prepare_notes", [project, a.id, "/home/bot/.battuta"]);
    assert.equal(notes.notes_path, `/home/bot/.battuta/projects/${project}/work/${a.id}/note.md`);
    assert.equal(notes.editable, true);
    assert.deepEqual(
      await rpc(sql, "assignment_prepare_notes", [project, a.id, "/home/bot/.battuta/"]),
      notes,
    );
    assert.equal(
      (await rpc(sql, "assignment_prepare_notes", [project, a.id, "/other"])).code,
      "notes_path_conflict",
    );
    await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
    for (const name of ["assignment_prepare_notes", "assignment_locate_notes"]) {
      const frozen = await rpc(sql, name, [
        project,
        a.id,
        ...(name.endsWith("prepare_notes") ? ["/other"] : []),
      ]);
      assert.equal(frozen.editable, false);
      assert.equal(frozen.notes_path, notes.notes_path);
    }
    const next = (await rpc(sql, "assignment_create", [project, "Next", ""])).assignment;
    await rpc(sql, "assignment_close", [project, next.id, "done"]);
    assert.equal(
      (await rpc(sql, "assignment_prepare_notes", [project, next.id, "/root"])).notes_path,
      null,
    );
  }),
);

Deno.test("close and concurrent mutations serialize through the parent lock", () =>
  withDatabaseTest(async (sql, project) => {
    const { assignment: a } = await rpc(sql, "assignment_create", [project, "Goal", ""]);
    let waiting: ReturnType<typeof rpc> | undefined;
    await sql.begin(async (tx) => {
      await rpc(tx, "assignment_append_todos", [project, a.id, ["First"]]);
      waiting = rpc(sql, "assignment_close", [project, a.id, "done"]);
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      for (let n = 0; n < 1000; n++) {
        const [{ blocked }] =
          await sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (blocked) return;
      }
      throw new Error("Competing close did not wait on parent lock");
    });
    assert.equal((await waiting)!.code, "unfinished_todos");
    const before = (await rpc(sql, "assignment_get", [project, a.id])).todos[0];
    await sql.begin(async (tx) => {
      await rpc(tx, "assignment_close", [project, a.id, "cancelled"]);
      waiting = rpc(sql, "assignment_update_todo", [
        project,
        a.id,
        1,
        before.updated_at,
        null,
        "done",
        null,
      ]);
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      for (let n = 0; n < 1000; n++) {
        const [{ blocked }] =
          await sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
        if (blocked) return;
      }
      throw new Error("Competing update did not wait on parent lock");
    });
    assert.equal((await waiting)!.code, "assignment_closed");
  }),
);

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
