import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { cleanup, invoke, secret, url } from "./local.ts";

const request = (conversation: string) => ({ operation: "send", sender_role: "api-sender", recipient_role: "api-recipient",
  conversation_id: conversation, message_type: "chat", content: { content: "Question" }, response_due_minutes: 10 });
const post = (body: unknown, apikey = secret) => fetch(`${url}/functions/v1/agent-mail`, {
  method: "POST", headers: { apikey, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("Edge Function authenticates, validates, and dispatches transactional send/reply/read RPCs", async () => {
  const conversation = randomUUID();
  try {
    assert.equal((await post(request(conversation), "invalid-key")).status, 401);
    for (const invalid of [
      { ...request(conversation), response_due_minutes: "10" },
      { ...request(conversation), response_due_minutes: 15 },
      { ...request(conversation), response_due: "tomorrow" },
      { ...request(conversation), conversation_id: "pm" },
      { ...request(conversation), content: { content: 42 } },
    ]) assert.equal((await post(invalid)).status, 400);
    const message = await invoke(request(conversation));
    assert.equal(message.conversation_id, conversation);
    assert.ok(message.response_due);
    assert.equal(Date.parse(message.response_due) - Date.parse(message.created_at), 600_000);
    const parent = { conversation_id: conversation, id: message.id };
    const reply = { operation: "reply", sender_role: "api-recipient", parent,
      message_type: "chat", content: { content: "Answer" }, response_due_minutes: null };
    assert.equal((await post(reply)).status, 400); // Business-rule failure from RPC.
    assert.equal(await invoke<boolean>({ operation: "read", recipient_role: "api-recipient", message_ref: parent }), true);
    const answer = await invoke(reply);
    assert.equal(answer.recipient, "api-sender");
    assert.equal(answer.conversation_id, conversation);
    assert.equal(answer.in_reply_to, message.id);
    assert.equal(answer.response_due, null);
    assert.equal((await post(reply)).status, 400);
  } finally { await cleanup([conversation]); }
});
