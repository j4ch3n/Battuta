import assert from "node:assert/strict";
import { rpc, withDatabaseTest } from "./helpers.ts";

Deno.test("complete plans publish atomically and dependency claims have one winner", () =>
  withDatabaseTest(async (sql, project) => {
    const a = await rpc(sql, "assignment_create", [project, "First", ["A"], "", []]);
    const b = await rpc(sql, "assignment_create", [
      project,
      "Second",
      ["B"],
      "",
      [a.assignment.id, a.assignment.id],
    ]);
    assert.equal(a.todos.length, 1);
    assert.equal(a.assignment.ready, true);
    assert.equal(b.assignment.dependencies.length, 1);
    assert.equal(b.assignment.ready, false);
    assert.equal(
      (await rpc(sql, "assignment_claim", [project, b.assignment.id])).reason,
      "dependencies",
    );
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => rpc(sql, "assignment_claim", [project, a.assignment.id])),
    );
    assert.equal(claims.filter((r) => r.ok).length, 1);
    const claimed = claims.find((r) => r.ok)!.assignment;
    assert.equal(claimed.status, "in_process");
    const [interval] =
      await sql`select lease_expired_at - claimed_at = interval '45 minutes' as valid from public.assignments where id = ${a.assignment.id}`;
    assert.equal(interval.valid, true);
    const missing = await rpc(sql, "assignment_create", [
      project,
      "Missing",
      ["Step"],
      "",
      ["00000000", "ffffffff"],
    ]);
    assert.equal(missing.code, "missing_dependencies");
    assert.deepEqual(missing.missing_assignment_ids, ["00000000", "ffffffff"]);
    assert.equal((await rpc(sql, "assignment_list", [project, null])).assignments.length, 2);
  }),
);

Deno.test("ordered reports preserve exact claims, block atomically and reactivate explicitly", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Goal", ["One", "Two"], "", []]);
    const id = created.assignment.id;
    const claim = await rpc(sql, "assignment_claim", [project, id]);
    const token = claim.assignment.claimed_at;
    assert.equal(
      (await rpc(sql, "assignment_start_todo", [project, id, token, 2, claim.todos[1].updated_at]))
        .code,
      "invalid_transition",
    );
    const first = await rpc(sql, "assignment_start_todo", [
      project,
      id,
      token,
      1,
      claim.todos[0].updated_at,
    ]);
    const completed = await rpc(sql, "assignment_record_todo_result", [
      project,
      id,
      token,
      1,
      first.todo.updated_at,
      "completed",
      "Verified",
      ["tests/proof.ts"],
      null,
    ]);
    assert.equal(completed.todo.status, "done");
    assert.deepEqual(completed.todo.evidence, ["tests/proof.ts"]);
    assert.equal(
      (await rpc(sql, "assignment_finish", [project, id, token])).code,
      "unfinished_todos",
    );
    const second = await rpc(sql, "assignment_start_todo", [
      project,
      id,
      token,
      2,
      claim.todos[1].updated_at,
    ]);
    const blocked = await rpc(sql, "assignment_record_todo_result", [
      project,
      id,
      token,
      2,
      second.todo.updated_at,
      "blocked",
      "Need input",
      [],
      "Missing authority",
    ]);
    assert.equal(blocked.assignment.status, "blocked");
    assert.equal(blocked.todo.status, "blocked");
    assert.equal(
      (await rpc(sql, "assignment_prepare_notes", [project, id, "/home/bot/.battuta"])).editable,
      true,
    );
    assert.equal(
      (await rpc(sql, "assignment_reactivate", [project, id])).code,
      "invalid_transition",
    );
    await rpc(sql, "assignment_update_todo", [
      project,
      id,
      2,
      blocked.todo.updated_at,
      null,
      "cancelled",
    ]);
    await rpc(sql, "assignment_append_todos", [project, id, ["Replacement"]]);
    const active = await rpc(sql, "assignment_reactivate", [project, id]);
    assert.equal(active.assignment.claimed_at, null);
    assert.equal((await rpc(sql, "assignment_finish", [project, id, token])).code, "stale_claim");
    const next = await rpc(sql, "assignment_claim", [project, id]);
    assert.notEqual(next.assignment.claimed_at, token);
    assert.equal(next.todos[0].outcome, "Verified");
    assert.equal(next.todos[1].blocker, "Missing authority");
  }),
);

Deno.test("current claim completes late and cancelled prerequisites never unlock dependents", () =>
  withDatabaseTest(async (sql, project) => {
    const created = await rpc(sql, "assignment_create", [project, "Late", ["Step"], "", []]);
    const id = created.assignment.id;
    await rpc(sql, "assignment_claim", [project, id]);
    await sql`update public.assignments set claimed_at = now() - interval '2 hours', lease_expired_at = now() - interval '75 minutes' where id = ${id}`;
    const detail = await rpc(sql, "assignment_get", [project, id]);
    const token = detail.assignment.claimed_at;
    for (const bad of [null, "infinity", "-infinity"]) {
      assert.equal(
        (await rpc(sql, "assignment_start_todo", [project, id, bad, 1, detail.todos[0].updated_at]))
          .code,
        "invalid_input",
      );
      assert.equal(
        (await rpc(sql, "assignment_start_todo", [project, id, token, 1, bad])).code,
        "invalid_input",
      );
    }
    const waiting = await rpc(sql, "assignment_create", [
      project,
      "After late work",
      ["Next"],
      "",
      [id],
    ]);
    assert.equal(waiting.assignment.ready, false);
    const start = await rpc(sql, "assignment_start_todo", [
      project,
      id,
      token,
      1,
      detail.todos[0].updated_at,
    ]);
    assert.equal(
      (
        await rpc(sql, "assignment_record_todo_result", [
          project,
          id,
          token,
          1,
          start.todo.updated_at,
          "completed",
          "Done",
          [],
          null,
        ])
      ).ok,
      true,
    );
    const done = await rpc(sql, "assignment_finish", [project, id, token]);
    assert.equal(done.assignment.status, "done");
    assert.equal(
      (await rpc(sql, "assignment_get", [project, waiting.assignment.id])).assignment.ready,
      true,
    );
    assert.equal((await rpc(sql, "assignment_claim", [project, waiting.assignment.id])).ok, true);
    assert.deepEqual(
      (await rpc(sql, "assignment_finish", [project, id, token])).assignment,
      done.assignment,
    );
    assert.equal((await rpc(sql, "assignment_locate_notes", [project, id])).editable, false);
    const prereq = await rpc(sql, "assignment_create", [project, "Cancel", ["Step"], "", []]);
    const dependent = await rpc(sql, "assignment_create", [
      project,
      "Wait",
      ["Step"],
      "",
      [prereq.assignment.id],
    ]);
    await rpc(sql, "assignment_close", [project, prereq.assignment.id, "cancelled"]);
    assert.equal(
      (await rpc(sql, "assignment_claim", [project, dependent.assignment.id])).reason,
      "dependencies",
    );
    assert.equal(
      (await rpc(sql, "assignment_reactivate", [project, id])).code,
      "assignment_closed",
    );
  }),
);
