import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendProgrammaticMail, MailSendError, UncertainWriteError } from "../transport.ts";
import { content } from "./fixtures.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const input = {
  senderRole: "worker" as const,
  recipientRole: "manager" as const,
  conversationId,
  content: content("Execution complete"),
};
const row = {
  conversation_id: conversationId,
  id: "123456abcdef",
  sender: "worker",
  recipient: "manager",
  message_type: "chat",
  content: input.content,
  status: "created",
  in_reply_to: null,
  response_due: null,
  created_at: "2026-11-04T12:00:00Z",
  read_at: null,
  replied_at: null,
};
function client(invoke: ReturnType<typeof vi.fn>) {
  return { functions: { invoke } } as unknown as SupabaseClient;
}

test.each(["worker", "cos", "manager"] as const)(
  "programmatic %s sends a validated chat and returns its reference",
  async (senderRole) => {
    const recipientRole = senderRole === "manager" ? "cos" : "manager";
    const invoke = vi.fn().mockResolvedValue({
      data: { data: { ...row, sender: senderRole, recipient: recipientRole } },
      error: null,
    });
    const result = await sendProgrammaticMail(client(invoke), {
      ...input,
      senderRole,
      recipientRole,
    });
    expect(result).toEqual({ conversation_id: conversationId, id: "123456abcdef" });
    expect(invoke).toHaveBeenCalledWith("agent-mail", {
      body: {
        operation: "send",
        sender_role: senderRole,
        recipient_role: recipientRole,
        conversation_id: conversationId,
        message_type: "chat",
        content: input.content,
        response_due_minutes: null,
      },
      signal: undefined,
    });
  },
);

test("invalid role, identity, or content never reaches the transport", async () => {
  const invoke = vi.fn();
  for (const patch of [
    { recipientRole: "cos" as const },
    { conversationId: "bad" },
    { content: { ...input.content, summary: " " } },
  ]) {
    await expect(
      sendProgrammaticMail(client(invoke), { ...input, ...patch }),
    ).rejects.toBeInstanceOf(MailSendError);
  }
  expect(invoke).not.toHaveBeenCalled();
});

test.each(["network", "server", "malformed", "mismatched"])(
  "%s acknowledgement is uncertain and never blindly retried",
  async (kind) => {
    const invoke = vi.fn(() => {
      if (kind === "network") throw new Error("connection lost");
      if (kind === "server")
        return Promise.resolve({
          data: null,
          error: {
            context: new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }),
          },
        });
      return Promise.resolve({
        data: {
          data:
            kind === "malformed"
              ? { id: "bad" }
              : { ...row, conversation_id: "22222222-2222-4222-8222-222222222222" },
        },
        error: null,
      });
    });
    await expect(sendProgrammaticMail(client(invoke), input)).rejects.toBeInstanceOf(
      UncertainWriteError,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  },
);

test("known backend validation refusal is a failed send, not an uncertain send", async () => {
  const invoke = vi.fn().mockResolvedValue({
    data: null,
    error: {
      context: new Response(JSON.stringify({ error: "Invalid recipient" }), { status: 400 }),
    },
  });
  await expect(sendProgrammaticMail(client(invoke), input)).rejects.toBeInstanceOf(MailSendError);
  expect(invoke).toHaveBeenCalledTimes(1);
});
