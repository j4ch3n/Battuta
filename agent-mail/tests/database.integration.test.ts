import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { cleanup, db, ok, row } from "./local.ts";
import type { Message, MessageReference } from "../schemas.ts";
import { content } from "./fixtures.ts";

const send = (conversation: string, overrides: Record<string, unknown> = {}) =>
  db
    .rpc("agent_mail_send", {
      p_sender_role: "pm",
      p_recipient_role: "tl",
      p_conversation_id: conversation,
      p_message_type: "chat",
      p_content: content("Question"),
      p_response_due_minutes: null,
      ...overrides,
    })
    .single<Message>();
const ref = (message: MessageReference) => ({
  conversation_id: message.conversation_id,
  id: message.id,
});
const read = (message: MessageReference, role = "tl") =>
  db
    .rpc("agent_mail_read", {
      p_recipient_role: role,
      p_conversation_id: message.conversation_id,
      p_message_id: message.id,
    })
    .returns<boolean>();
const reply = (parent: MessageReference, overrides: Record<string, unknown> = {}) =>
  db
    .rpc("agent_mail_reply", {
      p_sender_role: "tl",
      p_parent_conversation_id: parent.conversation_id,
      p_parent_id: parent.id,
      p_message_type: "chat",
      p_content: content("Answer"),
      p_response_due_minutes: null,
      ...overrides,
    })
    .single<Message>();

test("RPCs enforce role routing, JSON, enum types and database-time deadlines", async () => {
  const conversation = randomUUID();
  try {
    for (const minutes of [null, 5, 10, 20]) {
      const message = ok(await send(conversation, { p_response_due_minutes: minutes }));
      assert.match(message.id, /^[a-f0-9]{12}$/);
      assert.equal(message.conversation_id, conversation);
      assert.deepEqual(message.content, content("Question"));
      assert.equal(message.message_type, "chat");
      assert.equal(message.status, "created");
      if (minutes === null) assert.equal(message.response_due, null);
      else {
        assert.ok(message.response_due);
        assert.equal(
          Date.parse(message.response_due) - Date.parse(message.created_at),
          minutes * 60_000,
        );
      }
    }
    assert.equal(ok(await send(conversation, { p_message_type: "chase" })).message_type, "chase");
    // SQL roles are text and are not limited to the two configured Pi roles.
    assert.equal(
      ok(await send(conversation, { p_sender_role: "future-role" })).sender,
      "future-role",
    );
    for (const invalid of [
      { p_recipient_role: "pm" },
      { p_sender_role: "invalid role!" },
      { p_message_type: "unknown" },
      { p_content: null },
      { p_content: "plain text" },
      { p_content: [] },
      { p_content: 42 },
      { p_response_due_minutes: 0 },
      { p_response_due_minutes: 15 },
      { p_response_due_minutes: -5 },
    ])
      assert.ok((await send(conversation, invalid)).error, JSON.stringify(invalid));
    // Removed idempotency means identical new sends create separate messages.
    const first = ok(await send(conversation)),
      second = ok(await send(conversation));
    assert.notEqual(first.id, second.id);
    // The database checks only JSON-object storage, not the business schema.
    assert.deepEqual(
      ok(await send(conversation, { p_content: { arbitrary: { payload: true } } })).content,
      { arbitrary: { payload: true } },
    );
    assert.ok(
      (
        await db.from("agent_messages").insert({
          conversation_id: conversation,
          id: "111111111111",
          sender: "pm",
          recipient: "tl",
          content: [],
        })
      ).error,
    );
    for (const table of ["agent_mail_leases", "agent_mail_chases"])
      assert.ok((await db.from(table).select("*")).error);
    assert.ok(
      (await db.rpc("agent_mail_lease_session", { p_session: "pm", p_owner: randomUUID() })).error,
    );
    assert.ok(
      (
        await db.rpc("agent_mail_due_session", {
          p_session: "pm",
          p_deadline_seconds: 1,
          p_interval_seconds: 1,
        })
      ).error,
    );
    assert.ok(
      (
        await db.rpc("agent_mail_store", {
          p_sender_role: "pm",
          p_recipient_role: "tl",
          p_conversation_id: conversation,
          p_message_type: "chat",
          p_content: { content: "Bypass" },
          p_response_due_minutes: null,
        })
      ).error,
    );
  } finally {
    await cleanup([conversation]);
  }
});

test("composite references scope acknowledgement and atomic concurrent replies", async () => {
  const conversation = randomUUID(),
    other = randomUUID();
  try {
    const parent = ok(await send(conversation));
    ok(
      await db
        .from("agent_messages")
        .insert({ ...parent, conversation_id: other })
        .select("id"),
    );
    assert.ok((await reply(parent)).error); // Cannot reply before acceptance.
    assert.equal(ok(await read(parent, "pm")), false);
    assert.equal(ok(await read(parent)), true);
    assert.equal(ok(await read(parent)), false);
    assert.equal((await row({ conversation_id: other, id: parent.id })).status, "created");
    assert.ok((await reply(parent, { p_sender_role: "pm" })).error);
    assert.ok((await reply(parent, { p_parent_conversation_id: randomUUID() })).error);
    const attempts = await Promise.all([reply(parent), reply(parent)]);
    assert.equal(attempts.filter((attempt) => !attempt.error).length, 1);
    const successful = attempts.find((attempt) => !attempt.error);
    assert.ok(successful);
    const answer = ok(successful);
    assert.equal(answer.conversation_id, parent.conversation_id);
    assert.equal(answer.sender, "tl");
    assert.equal(answer.recipient, "pm");
    assert.equal(answer.in_reply_to, parent.id);
    assert.equal((await row(ref(parent))).status, "replied");
    assert.ok((await reply(parent)).error);
    ok(await read(answer, "pm"));
    const clarification = ok(
      await reply(answer, { p_sender_role: "pm", p_response_due_minutes: 5 }),
    );
    assert.equal(clarification.conversation_id, conversation);
    assert.equal(clarification.in_reply_to, answer.id);
    assert.equal(clarification.recipient, "tl");
    assert.ok(clarification.response_due);
    assert.equal(
      Date.parse(clarification.response_due) - Date.parse(clarification.created_at),
      300_000,
    );
  } finally {
    await cleanup([conversation, other]);
  }
});
