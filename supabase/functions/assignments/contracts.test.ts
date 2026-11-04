import assert from "node:assert/strict";
import { toolContracts } from "./contracts.ts";

const target = { project: "Atlas 地图", assignment_id: "a3f91c2e" };
Deno.test("strict explicit tool inputs preserve short identity and microsecond tokens", () => {
  for (const name of ["get_assignment", "locate_notes"] as const) {
    assert.equal(toolContracts[name].input.safeParse(target).success, true);
    for (const assignment_id of ["", "A3F91C2E", crypto.randomUUID(), "../a3f91c2e"]) {
      assert.equal(
        toolContracts[name].input.safeParse({ ...target, assignment_id }).success,
        false,
      );
    }
    assert.equal(toolContracts[name].input.safeParse({ ...target, role: "cos" }).success, false);
  }
  const update = {
    ...target,
    position: 2,
    expected_updated_at: "2026-11-04T12:00:00.123456+00:00",
    description: "  Edited\n链接  ",
  };
  assert.deepEqual(toolContracts.update_todo.input.parse(update), update);
  for (const patch of [
    { position: 0 },
    { expected_updated_at: "bad" },
    { description: null },
    { status: "blocked" },
    { description: " " },
  ]) {
    assert.equal(toolContracts.update_todo.input.safeParse({ ...update, ...patch }).success, false);
  }
  const { description: _, ...empty } = update;
  assert.equal(toolContracts.update_todo.input.safeParse(empty).success, false);
  assert.equal(
    toolContracts.append_todos.input.safeParse({ ...target, descriptions: [] }).success,
    false,
  );
  assert.equal(
    toolContracts.append_todos.input.safeParse({ ...target, descriptions: ["A", " "] }).success,
    false,
  );
  assert.equal(
    toolContracts.close_assignment.input.safeParse({ ...target, status: "active" }).success,
    false,
  );
  assert.equal(
    toolContracts.create_assignment.input.safeParse({ project: "../bad", goal: "Goal" }).success,
    false,
  );
  assert.equal(
    toolContracts.list_assignments.input.safeParse({ project: target.project, status: "active" })
      .success,
    true,
  );
  assert.equal(
    toolContracts.prepare_notes.input.safeParse({ ...target, root: "/home/bot/.battuta" }).success,
    true,
  );
});

Deno.test("creation publishes complete plans and listing may omit project", () => {
  assert.equal(
    toolContracts.create_assignment.input.safeParse({ project: "Atlas", goal: "Build" }).success,
    false,
  );
  assert.equal(
    toolContracts.create_assignment.input.safeParse({
      project: "Atlas",
      goal: "Build",
      initial_todos: ["Verify"],
      depends_on_assignment_ids: ["12345678"],
    }).success,
    true,
  );
  assert.equal(
    toolContracts.create_assignment.input.safeParse({
      project: "Atlas",
      goal: "Build",
      initial_todos: [],
    }).success,
    false,
  );
  assert.equal(
    toolContracts.list_assignments.input.safeParse({ status: "in_process" }).success,
    true,
  );
  assert.equal(
    toolContracts.close_assignment.input.safeParse({ ...target, status: "done" }).success,
    false,
  );
  assert.equal(
    toolContracts.update_todo.input.safeParse({
      ...target,
      position: 1,
      expected_updated_at: "2026-11-04T12:00:00.123456Z",
      status: "done",
    }).success,
    false,
  );
});

Deno.test("execution requires exact bound tokens and actionable refusal metadata", () => {
  const input = {
    ...target,
    claimed_at: "2026-11-04T12:00:00.123456+00:00",
    position: 1,
    expected_updated_at: "2026-11-04T12:00:01.654321+00:00",
    outcome: "completed",
    summary: "Verified",
    evidence: [],
  };
  assert.deepEqual(toolContracts.record_todo_result.input.parse(input), input);
  for (const patch of [
    { claimed_at: undefined },
    { expected_updated_at: "infinity" },
    { summary: "\u00a0" },
    { outcome: "blocked" },
    { evidence: [" "] },
    { blocker: "Unexpected" },
  ]) {
    assert.equal(
      toolContracts.record_todo_result.input.safeParse({ ...input, ...patch }).success,
      false,
    );
  }
  const missing = { ok: false, code: "missing_dependencies", message: "Inspect prerequisites" };
  assert.equal(toolContracts.create_assignment.output.safeParse(missing).success, false);
  assert.equal(
    toolContracts.create_assignment.output.safeParse({
      ...missing,
      missing_assignment_ids: ["12345678"],
    }).success,
    true,
  );
  assert.equal(
    toolContracts.start_todo.output.safeParse({
      ok: false,
      code: "stale_update",
      message: "Inspect",
    }).success,
    false,
  );
});
