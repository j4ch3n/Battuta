import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  envelope,
  ReplyArguments,
  SendArguments,
  sendRequest,
  replyRequest,
  validate,
  type Message,
} from "../schemas.ts";
import { content, completedContent, requestContent } from "./fixtures.ts";
import { validateCoverage } from "../content.ts";

const agent = { role: "pm" as const, sessionId: randomUUID() };
const intent = {
  recipient: "tl",
  message_type: "chat",
  content: content("Review the design"),
  reply_expectation: null,
};

test("LLM expectations translate to offsets; runtime owns identity and conversation", () => {
  for (const [window, minutes] of [
    [null, null],
    ["short", 5],
    ["medium", 10],
    ["long", 20],
  ]) {
    const request = sendRequest(agent, {
      ...intent,
      reply_expectation: window === null ? null : { window },
    });
    assert.equal(request.response_due_minutes, minutes);
    assert.equal(request.sender_role, "pm");
    assert.equal(request.conversation_id, agent.sessionId);
    assert.ok(!("response_due" in request));
    assert.ok(!("reply_expectation" in request));
  }
});

test("strict LLM schemas reject malformed, coerced, omitted and injected fields", () => {
  for (const bad of [
    { ...intent, recipient: "engineer" },
    { ...intent, recipient: agent.role },
    { ...intent, sender_role: "tl" },
    { ...intent, response_due: "tomorrow" },
    { ...intent, reply_expectation: { window: 5 } },
    { ...intent, reply_expectation: { window: "urgent" } },
    { ...intent, reply_expectation: { window: "short", expects_reply: false } },
    { ...intent, content: "plain text" },
    { ...intent, content: { content: 42 } },
    { ...intent, content: { content: " \n" } },
    { ...intent, content: { content: "x".repeat(16001) } },
    { ...intent, content: { content: "Valid", extra: true } },
    { ...intent, content: { ...intent.content, summary: " \n" } },
    { ...intent, content: { ...intent.content, summary: "x".repeat(2001) } },
    { ...intent, content: { ...intent.content, subject: "Invented title" } },
    { ...intent, content: { ...intent.content, kind: "technical_request" } },
    { ...intent, content: { ...intent.content, schema_version: 2 } },
    { ...intent, content: { ...intent.content, request: { action: "Investigate" } } },
    { recipient: "tl", message_type: "chat", content: { content: "missing expectation" } },
  ])
    assert.throws(() => sendRequest(agent, bad));
  assert.equal(validate(SendArguments, intent).reply_expectation, null);
});

test("reply requires a composite reference and transports no new conversation or recipient", () => {
  const parent = { conversation_id: randomUUID(), id: "a7c91e3b4d62" };
  const args = {
    parent,
    message_type: "chat",
    content: content("Answer"),
    reply_expectation: { window: "long" },
  };
  const request = replyRequest(agent, args);
  assert.deepEqual(request.parent, parent);
  assert.equal(request.response_due_minutes, 20);
  assert.ok(!("recipient_role" in request));
  assert.ok(!("conversation_id" in request));
  for (const badParent of [
    { id: parent.id },
    { conversation_id: "pm", id: parent.id },
    { conversation_id: parent.conversation_id, id: randomUUID() },
  ]) {
    assert.throws(() => validate(ReplyArguments, { ...args, parent: badParent }));
  }
});

test("injected JSON includes current and parent composite references", () => {
  const message: Message = {
    conversation_id: randomUUID(),
    id: "b8d02f4c5e73",
    in_reply_to: "a7c91e3b4d62",
    sender: "tl",
    recipient: "pm",
    message_type: "chat",
    content: content("Answer"),
    response_due: null,
    created_at: "2026-09-30T12:00:00Z",
    status: "created",
    read_at: null,
    replied_at: null,
  };
  const packed = envelope(message);
  assert.deepEqual(packed.message_ref, {
    conversation_id: message.conversation_id,
    id: message.id,
  });
  assert.deepEqual(packed.in_reply_to, {
    conversation_id: message.conversation_id,
    id: message.in_reply_to,
  });
  assert.equal(packed.response_due, null);
  assert.equal(envelope({ ...message, in_reply_to: null }).in_reply_to, null);
});

test("one role-independent schema requires explicit requests and evidence-backed completion", () => {
  const ask = {
    ...intent,
    content: requestContent("Assess feasibility", ["Use existing infrastructure"]),
  };
  assert.throws(() => sendRequest(agent, ask), /requires a non-null reply_expectation/);
  assert.ok(sendRequest(agent, { ...ask, reply_expectation: { window: "medium" } }));
  const done = completedContent("Investigation complete", ["Use existing infrastructure"]);
  assert.ok(sendRequest(agent, { ...intent, content: done }));
  assert.ok(sendRequest({ ...agent, role: "tl" }, { ...intent, recipient: "pm", content: done }));
  validateCoverage(done, [ask.content]);
  assert.throws(
    () => validateCoverage(done, [requestContent("Assess", ["A missing expectation"])]),
    /missing expectation/,
  );
  for (const bad of [
    content("Blocked", {
      result: { state: "blocked", accomplished: [], remaining: [], checks: [] },
    }),
    { ...done, result: { ...done.result!, remaining: ["Review pending"] } },
    { ...done, result: { ...done.result!, checks: [] } },
    {
      ...done,
      result: { ...done.result!, checks: [{ ...done.result!.checks[0], result: "failed" }] },
    },
    { ...done, result: { ...done.result!, checks: [{ ...done.result!.checks[0], evidence: [] }] } },
    content("Oversized", { context: Array(30).fill("x".repeat(4000)) }),
  ])
    assert.throws(() => sendRequest(agent, { ...intent, content: bad }));
});
