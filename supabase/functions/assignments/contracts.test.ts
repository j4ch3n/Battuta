import assert from "node:assert/strict";
import { toolContracts } from "./contracts.ts";

const target = { project: "Atlas 地图", assignment_id: "a3f91c2e" };
Deno.test("creation defaults specialist requirements and rejects malformed sets", () => {
  const input = { project: "Atlas", goal: "Goal", initial_todos: ["Step"] };
  assert.deepEqual(toolContracts.create_assignment.input.parse(input), {
    ...input,
    require_abilities: ["research"],
  });
  assert.deepEqual(
    toolContracts.create_assignment.input.parse({ ...input, require_abilities: ["mobile-control"] })
      .require_abilities,
    ["mobile-control"],
  );
  for (const require_abilities of [[], null, "mobile_use", [null], [1]]) {
    assert.equal(
      toolContracts.create_assignment.input.safeParse({ ...input, require_abilities }).success,
      false,
    );
  }
});

Deno.test("creation accepts only known difficulty levels", () => {
  const input = { project: "Atlas", goal: "Goal", initial_todos: ["Step"] };
  for (const difficulty of ["easy", "medium", "hard", "hail_mary"])
    assert.equal(
      toolContracts.create_assignment.input.parse({ ...input, difficulty }).difficulty,
      difficulty,
    );
  for (const difficulty of ["extreme", "", null, 1])
    assert.equal(
      toolContracts.create_assignment.input.safeParse({ ...input, difficulty }).success,
      false,
    );
});

const conversation = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
Deno.test("claim requires code-owned identity and an explicit ability set", () => {
  assert.equal(toolContracts.claim_assignment.input.safeParse(target).success, false);
  assert.deepEqual(
    toolContracts.claim_assignment.input.parse({
      ...target,
      claimed_by: "worker-1",
      abilities: [],
      conversation_id: conversation,
    }),
    { ...target, claimed_by: "worker-1", abilities: [], conversation_id: conversation },
  );
  for (const conversation_id of [undefined, "", "not-a-uuid"])
    assert.equal(
      toolContracts.claim_assignment.input.safeParse({
        ...target,
        claimed_by: "worker-1",
        abilities: [],
        conversation_id,
      }).success,
      false,
    );
  for (const claimed_by of ["", " ", null, "bad\0id"]) {
    assert.equal(
      toolContracts.claim_assignment.input.safeParse({
        ...target,
        claimed_by,
        abilities: [],
        conversation_id: conversation,
      }).success,
      false,
    );
  }
});
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
  assert.equal(toolContracts.prepare_notes.input.safeParse(target).success, true);
  for (const name of ["prepare_notes", "locate_notes"] as const) {
    for (const field of ["root", "projects_root", "notes_path"]) {
      assert.equal(
        toolContracts[name].input.safeParse({ ...target, [field]: "/chosen/by/model" }).success,
        false,
      );
    }
  }
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
    claimed_by: "worker-1",
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
