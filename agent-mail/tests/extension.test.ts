import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import extension from "../index.ts";
import { cleanup, db, ok, row, secret, url, wait } from "./local.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { SendArguments, type MessageReference } from "../schemas.ts";

type Delivery = { customType: string; content: string; display: boolean; details: { message_ref: MessageReference } };
type Entry = { type: "custom_message"; customType: string; content?: string; details: { message_ref: MessageReference } };
type Handler = (event?: unknown, context?: ExtensionContext) => Promise<void>;
type Tool = { name: string; execute: (callId: string, args: unknown, signal: undefined, update: undefined,
  context: ExtensionContext) => Promise<{ details: { message_ref: MessageReference } }> };
type Command = { handler: (instruction: string, context: ExtensionContext) => Promise<void> };

function session(role: "pm" | "tech-lead", id: string = randomUUID(), entries: Entry[] = [], autoAccept = true) {
  process.env.AGENT_ROLE = role;
  const handlers = new Map<string, Handler>(), tools = new Map<string, Tool>(), commands = new Map<string, Command>(), messages: Delivery[] = [];
  const ctx = { sessionManager: { getSessionId: () => id, getBranch: () => entries }, ui: { notify() {} } } as unknown as ExtensionContext;
  const accept = async (message: Delivery) => {
    entries.push({ type: "custom_message", customType: message.customType, content: message.content, details: message.details });
    await handlers.get("message_start")?.({ message: { role: "custom", ...message } });
  };
  const pi = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: Command) { commands.set(name, command); },
    sendMessage(message: Delivery) { messages.push(message); if (autoAccept) void accept(message); },
  };
  extension(pi as unknown as ExtensionAPI);
  return { id, pi, tools, commands, ctx, messages, entries, accept,
    execute: (name: string, args: unknown) => tools.get(name)!.execute(randomUUID(), args, undefined, undefined, ctx),
    start: () => handlers.get("session_start")!({}, ctx), stop: () => handlers.get("session_shutdown")!() };
}
const intent = (content: string, recipient: "pm" | "tech-lead" = "tech-lead",
  expectation: Static<typeof SendArguments>["reply_expectation"] = null): Static<typeof SendArguments> => ({ recipient, message_type: "chat",
  content: { content }, reply_expectation: expectation });

test("different Pi UUIDs communicate by role; JSON delivery, acceptance, replies and session changes", async () => {
  process.env.SUPABASE_URL = url; process.env.SUPABASE_SECRET_KEY = secret;
  const pm = session("pm"), lead = session("tech-lead", randomUUID(), [], false), sessions = [pm, lead];
  const conversations = [pm.id];
  try {
    assert.notEqual(pm.id, lead.id);
    await pm.start(); await lead.start();
    const sent = await pm.execute("send_agent_message", intent("Technical question", "tech-lead", { window: "medium" }));
    const ref = sent.details.message_ref;
    await wait(() => lead.messages.some((message) => message.details.message_ref.id === ref.id));
    const delivered = lead.messages.find((message) => message.details.message_ref.id === ref.id);
    assert.ok(delivered);
    assert.deepEqual(JSON.parse(delivered.content).message_ref, ref);
    assert.equal(JSON.parse(delivered.content).in_reply_to, null);
    assert.equal(JSON.parse(delivered.content).sender, "pm");
    assert.equal((await row(ref)).status, "created"); // Receipt alone is not read.
    await lead.accept(delivered);
    await wait(async () => (await row(ref)).status === "read");
    const answer = await lead.execute("reply_agent_message", { parent: ref, message_type: "chat",
      content: { content: "Technical answer" }, reply_expectation: null });
    assert.equal(answer.details.message_ref.conversation_id, pm.id);
    await wait(() => pm.messages.some((message) => message.details.message_ref.id === answer.details.message_ref.id));
    assert.deepEqual(JSON.parse(pm.messages.at(-1)!.content).in_reply_to, ref);
    assert.equal((await row(ref)).status, "replied");
    await assert.rejects(() => lead.execute("reply_agent_message", { parent: ref, message_type: "chat",
      content: { content: "Duplicate" }, reply_expectation: null }));
    await pm.stop();
    const resumed = session("pm", pm.id, pm.entries); sessions.push(resumed);
    await resumed.start();
    assert.equal(resumed.messages.length, 0);
    // Change the active session: new root sends use its UUID, never a cached ID.
    const nextId = randomUUID(); conversations.push(nextId);
    resumed.ctx.sessionManager.getSessionId = () => nextId;
    await resumed.start();
    const next = await resumed.execute("send_agent_message", intent("New session"));
    assert.equal(next.details.message_ref.conversation_id, nextId);
    assert.equal((await row(next.details.message_ref)).recipient, "tech-lead");
    // The direct complete-API command follows the same validated submission path.
    resumed.ctx.model = { id: "completion-test" } as NonNullable<ExtensionContext["model"]>;
    resumed.ctx.modelRegistry = { async complete() { return { stopReason: "toolUse", usage: {},
      content: [{ type: "toolCall", name: "send_agent_message", arguments: intent("Typed completion"), id: "complete-1" }] }; } } as unknown as ExtensionContext["modelRegistry"];
    await resumed.commands.get("agent-mail")!.handler("Ask the lead", resumed.ctx);
    const roots = ok(await db.from("agent_messages").select("content,conversation_id").eq("conversation_id", nextId)
      .returns<{ content: { content: string }; conversation_id: string }[]>());
    assert.ok(roots.some((message) => message.content.content === "Typed completion"));
    const count = roots.length;
    resumed.ctx.modelRegistry.complete = (async () => ({ stopReason: "length", content: [] })) as unknown as ExtensionContext["modelRegistry"]["complete"];
    await assert.rejects(() => resumed.commands.get("agent-mail")!.handler("Invalid completion", resumed.ctx));
    assert.equal(ok(await db.from("agent_messages").select("id").eq("conversation_id", nextId)).length, count);
  } finally {
    for (const item of sessions.reverse()) await item.stop();
    await cleanup(conversations);
  }
});

test("append-before-ack recovery and failed acknowledgement retry do not reinject mail", async () => {
  process.env.SUPABASE_URL = url; process.env.SUPABASE_SECRET_KEY = secret;
  const conversation = randomUUID();
  const stored = ok(await db.rpc("agent_mail_send", { p_sender_role: "pm", p_recipient_role: "tech-lead",
    p_conversation_id: conversation, p_message_type: "chat", p_content: { content: "Recover me" }, p_response_due_minutes: null }));
  const ref = { conversation_id: conversation, id: stored.id };
  const originalFetch = globalThis.fetch;
  let failRead = true;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/functions/v1/agent-mail") && typeof init?.body === "string" &&
      JSON.parse(init.body).operation === "read" && failRead) {
      failRead = false;
      return Response.json({ error: "Temporary acknowledgement failure" }, { status: 500 });
    }
    return originalFetch(input, init);
  };
  const lead = session("tech-lead", randomUUID(), [{ type: "custom_message", customType: "agent-mail", details: { message_ref: ref } }]);
  try {
    await lead.start();
    assert.equal(failRead, false);
    assert.equal((await row(ref)).status, "created");
    assert.equal(lead.messages.length, 0);
    await wait(async () => (await row(ref)).status === "read");
    assert.equal(lead.messages.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await lead.stop();
    await cleanup([conversation]);
  }
});
