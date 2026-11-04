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
    outcome: "  Evidence\n链接  ",
  };
  assert.deepEqual(toolContracts.update_todo.input.parse(update), update);
  for (const patch of [
    { position: 0 },
    { expected_updated_at: "bad" },
    { outcome: null },
    { status: "blocked" },
    { description: " " },
  ]) {
    assert.equal(toolContracts.update_todo.input.safeParse({ ...update, ...patch }).success, false);
  }
  const { outcome: _, ...empty } = update;
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
