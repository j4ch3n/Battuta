import { expect, test, vi } from "vitest";
import { createCoordinator } from "../coordinator.ts";
import { parseAbilities } from "../contracts.ts";
import { detail, settings } from "./fixtures.ts";

// Synthetic catalog entries exercise set routing without approving runtime abilities.
vi.mock("../../supabase/functions/assignments/abilities.json", () => ({
  default: {
    test_one: { description: "Test specialist one", tools: [] },
    test_two: { description: "Test specialist two", tools: [] },
  },
}));

test.each([
  { capabilities: ["test_one"], claims: false },
  { capabilities: ["test_one", "test_two", "test_one"], claims: true },
])("configured specialist subset: $capabilities", async ({ capabilities, claims }) => {
  const row = detail();
  row.assignment.require_abilities = ["test_one", "test_two"];
  const claim = vi.fn(() => {
    row.assignment.status = "in_process";
    row.assignment.claimed_at = row.assignment.created_at;
    row.assignment.claimed_by = "worker-test";
    return Promise.resolve(row);
  });
  const coordinator = createCoordinator({
    workerId: "worker-test",
    capabilities,
    conversationId: "22222222-2222-4222-8222-222222222222",
    settings: settings(),
    assignments: {
      list: () => Promise.resolve({ ok: true, assignments: [row.assignment] }),
      claim,
      get: () => Promise.resolve(row),
      start: vi.fn(),
      record: vi.fn(),
      block: vi.fn(),
      finish: vi.fn(),
      renew: vi.fn(),
      settings: vi.fn(),
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
          claimed_by: "worker-test",
          session_file: "/session",
        }),
      runTodo: vi.fn(),
      remind: vi.fn(),
      abort: vi.fn(),
      appendEntry: vi.fn(),
    },
    notify: vi.fn(),
    diagnostics: vi.fn(),
  });
  capabilities.length = 0;
  await coordinator.reconcile("idle");
  if (claims)
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed_by: "worker-test",
        abilities: ["test_one", "test_two"],
      }),
    );
  else expect(claim).not.toHaveBeenCalled();
  expect([...parseAbilities(["test_two", "test_two"])]).toEqual(["test_two"]);
  await coordinator.stop();
});
