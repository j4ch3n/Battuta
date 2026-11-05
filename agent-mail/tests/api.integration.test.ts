import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { cleanup, invoke, secret, url, db, row } from "./local.ts";
import { content, requestContent } from "./fixtures.ts";
import { sendProgrammaticMail } from "../transport.ts";

const request = (conversation: string) => ({
  operation: "send",
  sender_role: "api-sender",
  recipient_role: "api-recipient",
  conversation_id: conversation,
  message_type: "chat",
  content: requestContent("Question"),
  response_due_minutes: 10,
});

test("programmatic worker report reaches Manager through the existing mail contract", async () => {
  const conversationId = randomUUID();
  try {
    const ref = await sendProgrammaticMail(db, {
      senderRole: "worker",
      recipientRole: "manager",
      conversationId,
      content: content("Assignment blocked", {
        result: { state: "blocked", accomplished: [], remaining: ["Missing input"], checks: [] },
      }),
    });
    const stored = await row(ref);
    assert.equal(stored.sender, "worker");
    assert.equal(stored.recipient, "manager");
    assert.equal(stored.response_due, null);
    assert.equal(stored.content.result?.state, "blocked");
  } finally {
    await cleanup([conversationId]);
  }
});
const post = (body: unknown, apikey = secret) =>
  fetch(`${url}/functions/v1/agent-mail`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Edge Function authenticates, validates, and dispatches transactional send/reply/read RPCs", async () => {
  const conversation = randomUUID();
  try {
    assert.equal((await post(request(conversation), "invalid-key")).status, 401);
    for (const invalid of [
      { ...request(conversation), response_due_minutes: "10" },
      { ...request(conversation), response_due_minutes: 15 },
      { ...request(conversation), response_due: "tomorrow" },
      { ...request(conversation), conversation_id: "cos" },
      { ...request(conversation), content: "not a JSON object" },
      { ...request(conversation), content: [] },
    ])
      assert.equal((await post(invalid)).status, 400);
    const message = await invoke(request(conversation));
    assert.equal(message.conversation_id, conversation);
    assert.ok(message.response_due);
    assert.equal(Date.parse(message.response_due) - Date.parse(message.created_at), 600_000);
    const parent = { conversation_id: conversation, id: message.id };
    const reply = {
      operation: "reply",
      sender_role: "api-recipient",
      parent,
      message_type: "chat",
      content: content("Answer"),
      response_due_minutes: null,
    };
    assert.equal((await post(reply)).status, 400); // Business-rule failure from RPC.
    assert.equal(
      await invoke<boolean>({
        operation: "read",
        recipient_role: "api-recipient",
        message_ref: parent,
      }),
      true,
    );
    const answer = await invoke(reply);
    assert.equal(answer.recipient, "api-sender");
    assert.equal(answer.conversation_id, conversation);
    assert.equal(answer.in_reply_to, message.id);
    assert.equal(answer.response_due, null);
    assert.equal((await post(reply)).status, 400);
    // Supabase deliberately knows nothing about the business-content contract.
    const arbitrary = await invoke({
      ...request(conversation),
      content: { future_payload: [1, true, null] },
    });
    assert.deepEqual(arbitrary.content, { future_payload: [1, true, null] });
  } finally {
    await cleanup([conversation]);
  }
});
