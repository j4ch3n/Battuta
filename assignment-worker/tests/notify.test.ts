import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotifier } from "../notify.ts";
import { detail } from "./fixtures.ts";

vi.mock("@battuta/agent-mail/content", () => ({
  MAX_CONTENT_BYTES: 65536,
  validateContent: vi.fn(),
}));
vi.mock("@battuta/agent-mail/schemas", () => ({
  Content: {},
  validate: vi.fn(),
}));
vi.mock("@battuta/agent-mail/transport", () => ({
  UncertainWriteError: class UncertainWriteError extends Error {},
  sendProgrammaticMail: vi.fn(() =>
    Promise.resolve({ conversation_id: "conversation", id: "message" }),
  ),
}));

test("records one notification for repeated callbacks", async () => {
  const assignment = detail();
  assignment.assignment.status = "done";
  assignment.todos[0].status = "done";
  const appendEntry = vi.fn();
  const notify = createNotifier({
    client: {} as SupabaseClient,
    conversationId: "conversation",
    appendEntry,
  });

  const [first, second] = await Promise.all([notify(assignment), notify(assignment)]);
  expect(first).toEqual({
    state: "sent",
    reference: { conversation_id: "conversation", id: "message" },
  });
  expect(second).toEqual(first);
  expect(appendEntry).toHaveBeenCalledTimes(2);
});
