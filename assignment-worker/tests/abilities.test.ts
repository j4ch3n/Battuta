import { expect, test, vi } from "vitest";
import { createCoordinator } from "../coordinator.ts";
import { parseAbilities } from "../contracts.ts";
import { detail } from "./fixtures.ts";

// Synthetic catalog entries exercise set routing without approving runtime abilities.
vi.mock("../../supabase/functions/assignments/abilities.json", () => ({
  default: {
    test_one: { description: "Test specialist one", tools: [] },
    test_two: { description: "Test specialist two", tools: [] },
  },
}));

test("claims require all specialists and a live session set cannot be replaced", async () => {
  const row = detail();
  row.assignment.require_abilities = ["test_one", "test_two"];
  const claim = vi.fn(() => {
    row.assignment.status = "in_process";
    row.assignment.claimed_at = row.assignment.created_at;
    row.assignment.claim_by = "worker-test";
    return Promise.resolve(row);
  });
  const coordinator = createCoordinator({
    workerId: "worker-test",
    assignments: {
      list: () => Promise.resolve({ ok: true, assignments: [row.assignment] }),
      claim,
      get: () => Promise.resolve(row),
      start: vi.fn(),
      record: vi.fn(),
      block: vi.fn(),
      finish: vi.fn(),
      close: vi.fn(),
    },
    sessions: {
      isIdle: () => true,
      hasPendingMessages: () => false,
      prepareWorkspace: () => Promise.resolve({ directory: "/local", notePath: "/local/note.md" }),
      openAssignmentSession: () =>
        Promise.resolve({
          project: row.assignment.project,
          assignment_id: row.assignment.id,
          claimed_at: row.assignment.claimed_at!,
          claim_by: "worker-test",
          session_file: "/session",
        }),
      runTodo: vi.fn(),
      appendEntry: vi.fn(),
    },
    notify: vi.fn(),
    diagnostics: vi.fn(),
  });
  coordinator.registerAbilities(["test_one"]);
  await coordinator.reconcile("idle");
  expect(claim).not.toHaveBeenCalled();
  coordinator.registerAbilities(["test_one", "test_two", "test_one"]);
  await coordinator.reconcile("idle");
  expect(claim).toHaveBeenCalledWith(
    expect.objectContaining({
      claim_by: "worker-test",
      abilities: ["test_one", "test_two"],
    }),
  );
  expect(() => coordinator.registerAbilities(["test_one"])).toThrow(
    "while an assignment is claimed",
  );
  expect(() => coordinator.registerAbilities(["test_two", "test_one"])).not.toThrow();
  expect([...parseAbilities(["test_two", "test_two"])]).toEqual(["test_two"]);
  await coordinator.stop();
});
