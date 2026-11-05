import assert from "node:assert/strict";
import type postgres from "postgres";
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

async function waitForParentLock(sql: postgres.Sql, tx: postgres.TransactionSql) {
  const [{ pid }] = await tx`select pg_backend_pid() as pid`;
  for (let n = 0; n < 1000; n++) {
    const [{ blocked }] =
      await sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as blocked`;
    if (blocked) return;
  }
  throw new Error("Competing mutation did not wait for the parent lock");
}

Deno.test(
  "explicit identity validates Unicode text and rejects partial plans without publication",
  () =>
    withDatabaseTest(async (sql, project) => {
      const [{ revision }] = await sql`select revision::text from public.assignment_availability`;
      for (const text of blankText) {
        for (const args of [
          [text, "Goal", ["Step"], "", []],
          [project, text, ["Step"], "", []],
          [project, "Goal", ["Keep", text], "", []],
        ]) {
          assert.equal((await rpc(sql, "assignment_create", args)).code, "invalid_input");
        }
      }
      for (const batch of [null, [], [null], ["One", null], [["Nested"]]]) {
        assert.equal(
          (await rpc(sql, "assignment_create", [project, "Goal", batch, "", []])).code,
          "invalid_input",
        );
      }
      for (const dependencies of [null, [null], ["bad"], [["12345678"]]]) {
        assert.equal(
          (await rpc(sql, "assignment_create", [project, "Goal", ["Step"], "", dependencies])).code,
          "invalid_input",
        );
      }
      const [nonstandard] =
        await sql`select public.assignment_create(${project},'Goal','[0:0]={Step}'::text[],'','{}'::text[]) as result`;
      assert.equal(nonstandard.result.code, "invalid_input");
      assert.deepEqual((await rpc(sql, "assignment_list", [project, null])).assignments, []);
      assert.equal(
        (await sql`select revision::text from public.assignment_availability`)[0].revision,
        revision,
      );
      const a = (
        await rpc(sql, "assignment_create", [project, "Goal", ["Keep"], "No publishing", []])
      ).assignment;
      assert.match(a.id, /^[0-9a-f]{8}$/);
      assert.equal(
        (await rpc(sql, "assignment_get", [project, a.id])).assignment.constraints,
        "No publishing",
      );
      assert.equal(
        (await rpc(sql, "assignment_get", [project + "-wrong", a.id])).code,
        "not_found",
      );
      for (const bad of ["", ".hidden", "a/b", "a\\b", "a\nb", "  "]) {
        assert.equal(
          (await rpc(sql, "assignment_create", [bad, "Goal", ["Step"], "", []])).code,
          "invalid_input",
        );
      }
      for (const id of ["bad", crypto.randomUUID(), "ABCDEF12"])
        assert.equal((await rpc(sql, "assignment_get", [project, id])).code, "invalid_input");
      await assert.rejects(sql`update public.assignments set goal=${"\t\n"} where id=${a.id}`, {
        code: "23514",
      });
      await assert.rejects(
        sql`update public.todos set description=${"\ufeff"} where assignment_id=${a.id}`,
        { code: "23514" },
      );
    }),
);

Deno.test("cross-project prerequisites and global listing preserve exact scoped targets", () =>
  withDatabaseTest(async (sql, project) => {
    await withDatabaseTest(async (other, secondProject) => {
      const a = (await rpc(sql, "assignment_create", [project, "First", ["A"], "", []])).assignment;
      const b = (
        await rpc(other, "assignment_create", [secondProject, "Second", ["B"], "", [a.id]])
      ).assignment;
      assert.deepEqual(b.dependencies, [{ assignment_id: a.id, project, status: "active" }]);
      assert.equal((await rpc(sql, "assignment_get", [project, b.id])).code, "not_found");
      const global = (await rpc(sql, "assignment_list", [null, "active"])).assignments;
      assert.ok(global.some((row) => row.id === a.id));
      assert.ok(global.some((row) => row.id === b.id));
      assert.deepEqual(
        (await rpc(sql, "assignment_list", [project, "active"])).assignments.map((a) => a.id),
        [a.id],
      );
    });
  }),
);

Deno.test("Manager edits only unfinished nonexecuting work with exact update tokens", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Goal", ["Keep"], "", []]);
    const id = created.assignment.id,
      before = created.todos[0];
    for (const description of blankText)
      assert.equal(
        (
          await rpc(sql, "assignment_update_todo", [
            project,
            id,
            1,
            before.updated_at,
            description,
            null,
          ])
        ).code,
        "invalid_input",
      );
    for (const status of ["done", "todo", "in_progress", "blocked"])
      assert.equal(
        (
          await rpc(sql, "assignment_update_todo", [
            project,
            id,
            1,
            before.updated_at,
            null,
            status,
          ])
        ).code,
        "invalid_input",
      );
    const edited = await rpc(sql, "assignment_update_todo", [
      project,
      id,
      1,
      before.updated_at,
      "Edited",
      null,
    ]);
    assert.notEqual(edited.todo.updated_at, before.updated_at);
    assert.equal(
      (
        await rpc(sql, "assignment_update_todo", [
          project,
          id,
          1,
          before.updated_at,
          "Overwrite",
          null,
        ])
      ).code,
      "stale_update",
    );
    await rpc(sql, "assignment_claim", [project, id]);
    assert.equal(
      (
        await rpc(sql, "assignment_update_todo", [
          project,
          id,
          1,
          edited.todo.updated_at,
          "Changed",
          null,
        ])
      ).code,
      "invalid_transition",
    );
    assert.equal(
      (await rpc(sql, "assignment_append_todos", [project, id, ["Late"]])).code,
      "invalid_transition",
    );
  }),
);

Deno.test("append batches are atomic and concurrent positions remain consecutive", () =>
  withDatabaseTest(async (sql, project) => {
    const a = (await rpc(sql, "assignment_create", [project, "Goal", ["Initial"], "", []]))
      .assignment;
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
      assert.equal((await rpc(sql, "assignment_get", [project, a.id])).todos.length, 1);
    }
    await Promise.all(
      Array.from({ length: 8 }, () =>
        rpc(sql, "assignment_append_todos", [project, a.id, ["A", "B"]]),
      ),
    );
    assert.deepEqual(
      (await rpc(sql, "assignment_get", [project, a.id])).todos.map((t) => t.position),
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
  }),
);

Deno.test(
  "claim execution rejects invalid reports and stale item versions without losing evidence",
  () =>
    withDatabaseTest(async (sql, project) => {
      const a = (await rpc(sql, "assignment_create", [project, "Goal", ["One"], "", []]))
        .assignment;
      const claim = await rpc(sql, "assignment_claim", [project, a.id]);
      const token = claim.assignment.claimed_at;
      const started = await rpc(sql, "assignment_start_todo", [
        project,
        a.id,
        token,
        1,
        claim.todos[0].updated_at,
      ]);
      for (const [outcome, summary, evidence, blocker] of [
        ["completed", " ", [], null],
        ["blocked", "Blocked", [], null],
        ["completed", "Done", [], "Unexpected"],
        ["completed", "Done", [" "], null],
        ["completed", "Done", [null], null],
        ["completed", "Done", [["Nested"]], null],
      ]) {
        assert.equal(
          (
            await rpc(sql, "assignment_record_todo_result", [
              project,
              a.id,
              token,
              1,
              started.todo.updated_at,
              outcome,
              summary,
              evidence,
              blocker,
            ])
          ).code,
          "invalid_input",
        );
      }
      assert.equal(
        (
          await rpc(sql, "assignment_start_todo", [
            project,
            a.id,
            token,
            1,
            claim.todos[0].updated_at,
          ])
        ).code,
        "stale_update",
      );
      const done = await rpc(sql, "assignment_record_todo_result", [
        project,
        a.id,
        token,
        1,
        started.todo.updated_at,
        "completed",
        "Verified",
        ["proof"],
        null,
      ]);
      assert.equal(
        (
          await rpc(sql, "assignment_record_todo_result", [
            project,
            a.id,
            token,
            1,
            started.todo.updated_at,
            "completed",
            "Other",
            [],
            null,
          ])
        ).code,
        "stale_update",
      );
      await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
      const detail = await rpc(sql, "assignment_get", [project, a.id]);
      assert.deepEqual(detail.todos, [done.todo]);
      assert.equal(
        (await rpc(sql, "assignment_finish", [project, a.id, token])).code,
        "stale_claim",
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
            done.todo.updated_at,
            null,
            "cancelled",
          ])
        ).code,
        "assignment_closed",
      );
    }),
);

Deno.test("runtime blockers preserve explanations and terminal cancellation is idempotent", () =>
  withDatabaseTest(async (sql, project) => {
    for (const start of [false, true]) {
      const a = (await rpc(sql, "assignment_create", [project, "Goal", ["One"], "", []]))
        .assignment;
      const claim = await rpc(sql, "assignment_claim", [project, a.id]);
      const token = claim.assignment.claimed_at;
      if (start)
        await rpc(sql, "assignment_start_todo", [
          project,
          a.id,
          token,
          1,
          claim.todos[0].updated_at,
        ]);
      const blocked = await rpc(sql, "assignment_block", [project, a.id, token, "Provider failed"]);
      assert.equal(blocked.assignment.blocker, "Provider failed");
      assert.deepEqual(
        (await rpc(sql, "assignment_block", [project, a.id, token, "Provider failed"])).assignment,
        blocked.assignment,
      );
      assert.equal(
        (await rpc(sql, "assignment_block", [project, a.id, token, "Different"])).code,
        "stale_claim",
      );
      assert.equal(
        (await rpc(sql, "assignment_get", [project, a.id])).todos[0].status,
        start ? "blocked" : "todo",
      );
      const cancelled = await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
      assert.equal(cancelled.assignment.blocker, "Provider failed");
      assert.deepEqual(
        (await rpc(sql, "assignment_close", [project, a.id, "cancelled"])).assignment,
        cancelled.assignment,
      );
    }
  }),
);

Deno.test("all-cancelled or empty plans cannot be claimed", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Goal", ["One"], "", []]);
    await rpc(sql, "assignment_update_todo", [
      project,
      created.assignment.id,
      1,
      created.todos[0].updated_at,
      null,
      "cancelled",
    ]);
    assert.equal(
      (await rpc(sql, "assignment_claim", [project, created.assignment.id])).reason,
      "no_executable_todos",
    );
    await sql`insert into public.assignments(id,project,goal) values('aabbccdd',${project},'Empty')`;
    assert.equal(
      (await rpc(sql, "assignment_claim", [project, "aabbccdd"])).reason,
      "no_executable_todos",
    );
  }),
);

Deno.test("notes keep local path safety and freeze only terminal assignments", () =>
  withDatabaseTest(async (sql, project) => {
    const a = (await rpc(sql, "assignment_create", [project, "Goal", ["Step"], "", []])).assignment;
    const invalidRoot = await rpc(sql, "assignment_prepare_notes", [project, a.id, null]);
    assert.equal(invalidRoot.code, "invalid_input");
    assert.equal(typeof invalidRoot.message, "string");
    assert.equal(
      (await rpc(sql, "assignment_locate_notes", [project, a.id])).code,
      "notes_unprepared",
    );
    for (const root of ["~/root", "relative", "/a/../b", "/a/./b", "/a//b", "/a\\b", "/a\nb", ""])
      assert.equal(
        (await rpc(sql, "assignment_prepare_notes", [project, a.id, root])).code,
        "invalid_input",
      );
    const prepared = await rpc(sql, "assignment_prepare_notes", [
      project,
      a.id,
      "/home/bot/.battuta",
    ]);
    assert.equal(
      prepared.notes_path,
      `/home/bot/.battuta/projects/${project}/work/${a.id}/note.md`,
    );
    assert.deepEqual(
      await rpc(sql, "assignment_prepare_notes", [project, a.id, "/home/bot/.battuta/"]),
      prepared,
    );
    const claim = await rpc(sql, "assignment_claim", [project, a.id]);
    assert.equal((await rpc(sql, "assignment_locate_notes", [project, a.id])).editable, true);
    await rpc(sql, "assignment_block", [project, a.id, claim.assignment.claimed_at, "Blocked"]);
    assert.equal((await rpc(sql, "assignment_locate_notes", [project, a.id])).editable, true);
    assert.equal(
      (await rpc(sql, "assignment_prepare_notes", [project, a.id, "/other"])).code,
      "notes_path_conflict",
    );
    await rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
    for (const operation of ["assignment_locate_notes", "assignment_prepare_notes"]) {
      const frozen = await rpc(sql, operation, [
        project,
        a.id,
        ...(operation.endsWith("prepare_notes") ? ["/other"] : []),
      ]);
      assert.equal(frozen.editable, false);
      assert.equal(frozen.notes_path, prepared.notes_path);
    }
  }),
);

Deno.test("append versus claim observes both serialized orderings", () =>
  withDatabaseTest(async (sql, project) => {
    for (const first of ["append", "claim"]) {
      const a = (await rpc(sql, "assignment_create", [project, "Race", ["Initial"], "", []]))
        .assignment;
      let pending: ReturnType<typeof rpc> | undefined;
      await sql.begin(async (tx) => {
        if (first === "append") {
          await rpc(tx, "assignment_append_todos", [project, a.id, ["Added"]]);
          pending = rpc(sql, "assignment_claim", [project, a.id]);
        } else {
          await rpc(tx, "assignment_claim", [project, a.id]);
          pending = rpc(sql, "assignment_append_todos", [project, a.id, ["Added"]]);
        }
        await waitForParentLock(sql, tx);
      });
      const result = await pending!;
      assert.equal(result.ok, first === "append");
      assert.equal(
        (await rpc(sql, "assignment_get", [project, a.id])).todos.length,
        first === "append" ? 2 : 1,
      );
    }
  }),
);

Deno.test("result and finish race cancellation on the same parent lock", () =>
  withDatabaseTest(async (sql, project) => {
    for (const operation of ["result", "finish"])
      for (const cancelFirst of [false, true]) {
        const a = (await rpc(sql, "assignment_create", [project, "Race", ["Step"], "", []]))
          .assignment;
        const claim = await rpc(sql, "assignment_claim", [project, a.id]);
        const token = claim.assignment.claimed_at;
        const started = await rpc(sql, "assignment_start_todo", [
          project,
          a.id,
          token,
          1,
          claim.todos[0].updated_at,
        ]);
        const writeArgs = [
          project,
          a.id,
          token,
          1,
          started.todo.updated_at,
          "completed",
          "Proof",
          [],
          null,
        ];
        if (operation === "finish") await rpc(sql, "assignment_record_todo_result", writeArgs);
        const name = operation === "result" ? "assignment_record_todo_result" : "assignment_finish";
        const args = operation === "result" ? writeArgs : [project, a.id, token];
        let pending: ReturnType<typeof rpc> | undefined;
        await sql.begin(async (tx) => {
          if (cancelFirst) {
            await rpc(tx, "assignment_close", [project, a.id, "cancelled"]);
            pending = rpc(sql, name, args);
          } else {
            await rpc(tx, name, args);
            pending = rpc(sql, "assignment_close", [project, a.id, "cancelled"]);
          }
          await waitForParentLock(sql, tx);
        });
        const result = await pending!;
        assert.equal(result.ok, !cancelFirst && operation === "result");
        assert.equal(
          (await rpc(sql, "assignment_get", [project, a.id])).assignment.status,
          !cancelFirst && operation === "finish" ? "done" : "cancelled",
        );
      }
  }),
);

Deno.test("reactivation serializes against obsolete execution writes", () =>
  withDatabaseTest(async (sql, project) => {
    for (const reactivateFirst of [false, true]) {
      const a = (await rpc(sql, "assignment_create", [project, "Race", ["Step"], "", []]))
        .assignment;
      const claim = await rpc(sql, "assignment_claim", [project, a.id]);
      const token = claim.assignment.claimed_at;
      await rpc(sql, "assignment_block", [project, a.id, token, "Missing input"]);
      let pending: ReturnType<typeof rpc> | undefined;
      await sql.begin(async (tx) => {
        if (reactivateFirst) {
          await rpc(tx, "assignment_reactivate", [project, a.id]);
          pending = rpc(sql, "assignment_block", [project, a.id, token, "Late error"]);
        } else {
          assert.equal(
            (await rpc(tx, "assignment_block", [project, a.id, token, "Late error"])).code,
            "stale_claim",
          );
          pending = rpc(sql, "assignment_reactivate", [project, a.id]);
        }
        await waitForParentLock(sql, tx);
      });
      assert.equal((await pending!).ok, !reactivateFirst);
      assert.equal((await rpc(sql, "assignment_get", [project, a.id])).assignment.status, "active");
    }
  }),
);

Deno.test("complete large reads and collision retries never overwrite existing records", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Large", ["Initial"], "", []]);
    await sql`insert into public.todos(assignment_id,position,description) select ${created.assignment.id},n,'Step '||n from generate_series(1001,2,-1) n`;
    assert.deepEqual(
      (await rpc(sql, "assignment_get", [project, created.assignment.id])).todos.map(
        (t) => t.position,
      ),
      Array.from({ length: 1001 }, (_, i) => i + 1),
    );
    await sql`update public.assignments set created_at='2026-01-01' where id=${created.assignment.id}`;
    await sql`insert into public.assignments(id,project,goal,status,closed_at,created_at) select left(md5(${project}||n),8),${project},'History','done',now(),'2026-01-01'::timestamptz from generate_series(1,1000) n`;
    const rows = (await rpc(sql, "assignment_list", [project, null])).assignments;
    assert.equal(rows.length, 1001);
    assert.deepEqual(
      rows.map((a) => a.id),
      rows
        .map((a) => a.id)
        .sort()
        .reverse(),
    );
    const rollback = new Error("test rollback");
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx`insert into public.assignments(id,project,goal,status,closed_at) values('1234abcd',${project},'Preserve','done',now())`;
        await tx`create temporary sequence assignment_test_ids`;
        await tx.unsafe(
          `create function pg_temp.assignment_test_uuid() returns uuid language sql as $$ select case when nextval('pg_temp.assignment_test_ids')=1 then '1234abcd-0000-4000-8000-000000000000'::uuid else 'abcd1234-0000-4000-8000-000000000000'::uuid end $$`,
        );
        const [{ definition }] =
          await tx`select pg_get_functiondef('public.assignment_create(text,text,text[],text,text[])'::regprocedure) as definition`;
        await tx.unsafe(definition.replace("gen_random_uuid()", "pg_temp.assignment_test_uuid()"));
        assert.equal(
          (await rpc(tx, "assignment_create", [project, "Fresh", ["Step"], "", []])).assignment.id,
          "abcd1234",
        );
        assert.equal(
          (await rpc(tx, "assignment_get", [project, "1234abcd"])).assignment.goal,
          "Preserve",
        );
        await tx.unsafe(
          `create or replace function pg_temp.assignment_test_uuid() returns uuid language sql as $$ select '1234abcd-0000-4000-8000-000000000000'::uuid $$`,
        );
        assert.equal(
          (await rpc(tx, "assignment_create", [project, "Never saved", ["Step"], "", []])).code,
          "id_exhausted",
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  }),
);
