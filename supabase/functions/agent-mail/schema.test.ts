import assert from "node:assert/strict";
import { parseRequest, rpcRequest } from "./schema.ts";

const conversation = "b8fe06dc-8855-4a5a-86d1-968fd8d936f4";
const send = {
  operation: "send",
  sender_role: "pm",
  recipient_role: "tl",
  conversation_id: conversation,
  message_type: "chat",
  content: { future: [1, true, null] },
  response_due_minutes: 10,
};

Deno.test("transport validates without coercion or accepting injected fields", () => {
  assert.deepEqual(parseRequest(send), send);
  for (const invalid of [
    { ...send, response_due_minutes: "10" },
    { ...send, response_due_minutes: 15 },
    { ...send, conversation_id: "pm" },
    { ...send, content: [] },
    { ...send, response_due: "tomorrow" },
  ]) {
    assert.throws(() => parseRequest(invalid));
  }
});

Deno.test("send, reply and read map composite references to the appropriate RPC", () => {
  const parent = { conversation_id: conversation, id: "012345abcdef" };
  const request = rpcRequest(parseRequest(send));
  assert.equal(request.name, "agent_mail_send");
  assert.equal(request.args.p_conversation_id, conversation);
  const reply = rpcRequest(
    parseRequest({
      operation: "reply",
      sender_role: "tl",
      parent,
      message_type: "chat",
      content: {},
      response_due_minutes: null,
    }),
  );
  assert.equal(reply.name, "agent_mail_reply");
  assert.ok("p_parent_id" in reply.args && "p_parent_conversation_id" in reply.args);
  assert.equal(reply.args.p_parent_id, parent.id);
  assert.equal(reply.args.p_parent_conversation_id, conversation);
  assert.equal("p_recipient_role" in reply.args, false);
  assert.deepEqual(
    rpcRequest(parseRequest({ operation: "read", recipient_role: "tl", message_ref: parent })),
    {
      name: "agent_mail_read",
      args: { p_recipient_role: "tl", p_conversation_id: conversation, p_message_id: parent.id },
    },
  );
});
