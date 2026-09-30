import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { completeMailIntent } from "../completion.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Complete = ExtensionContext["modelRegistry"]["complete"];
type CompleteRequest = Parameters<Complete>[1];
type CompleteOptions = Parameters<Complete>[2];
type Answer = Awaited<ReturnType<Complete>>;
type Model = NonNullable<ExtensionContext["model"]>;

const args = { recipient: "tech-lead", message_type: "chat", content: { content: "Review" }, reply_expectation: { window: "medium" } };
const toolCall = (name: string, arguments_: unknown) => ({ type: "toolCall", name, arguments: arguments_, id: "call-1" });
const response = (content: unknown[], stopReason = "toolUse") => ({ content, stopReason, usage: { input: 10, output: 20 } }) as Answer;
const context = (answer: Answer, inspect: (model: Model, request: CompleteRequest, options: CompleteOptions) => void = () => {}) =>
  ({ model: { id: "test-model" }, modelRegistry: {
    async complete(model: Model, request: CompleteRequest, options: CompleteOptions) { inspect(model, request, options); return answer; },
  } }) as unknown as ExtensionContext;

test("complete API receives TypeBox tools and yields validated typed intent", async () => {
  const signal = new AbortController().signal;
  let inspected = false;
  const result = await completeMailIntent(context(response([toolCall("send_agent_message", args)]), (_model, request, options) => {
    inspected = true;
    assert.deepEqual(request.tools?.map((tool) => tool.name), ["send_agent_message", "reply_agent_message"]);
    assert.equal(JSON.parse(JSON.stringify(request.tools?.[0].parameters)).additionalProperties, false);
    assert.equal(options?.signal, signal);
    assert.ok(request.systemPrompt);
    assert.match(request.systemPrompt, /You are the pm agent/);
    const message = request.messages[0];
    assert.ok(message.role === "user" && typeof message.content === "string");
    assert.deepEqual(JSON.parse(message.content).incoming_mail, ["incoming JSON"]);
  }), "Ask for review", ["incoming JSON"], "pm", signal);
  assert.ok(inspected);
  assert.deepEqual(result.args, args);
  assert.deepEqual(result.usage, { input: 10, output: 20 });
});

test("completion accepts a reply only with its inherited composite reference", async () => {
  const reply = { parent: { conversation_id: randomUUID(), id: "a7c91e3b4d62" },
    message_type: "chat", content: { content: "Answer" }, reply_expectation: null };
  const result = await completeMailIntent(context(response([toolCall("reply_agent_message", reply)])), "Reply", [], "tech-lead");
  assert.ok(result.name === "reply_agent_message");
  assert.deepEqual(result.args.parent, reply.parent);
});

test("failed, truncated, ambiguous and invalid completions cannot become mail", async () => {
  const good = toolCall("send_agent_message", args);
  for (const bad of [
    response([good], "length"), response([good], "error"), response([good], "aborted"),
    response([{ type: "text", text: JSON.stringify(args) }], "stop"), response([]),
    response([good, good]), response([toolCall("other_tool", args)]),
    response([toolCall("send_agent_message", { ...args, reply_expectation: { window: 10 } })]),
    response([toolCall("reply_agent_message", { ...args, parent: { id: "a7c91e3b4d62" } })]),
  ]) await assert.rejects(() => completeMailIntent(context(bad), "Send", [], "pm"));
});
