import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import extension from "../index.ts";
import { cleanup, db, ok, row, secret, url, wait } from "./local.ts";
import type {
  BoundaryResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { SendArguments, validate, type Message, type MessageReference } from "../schemas.ts";
import { content, requestContent, completedContent } from "./fixtures.ts";

type Delivery = {
  customType: string;
  content: string;
  display: boolean;
  details: { message_ref: MessageReference };
};
type Entry =
  | {
      type: "custom_message";
      customType: string;
      content?: string;
      details: { message_ref: MessageReference };
    }
  | { type: "custom"; customType: string; data: unknown };
type Handler = (event?: unknown, context?: ExtensionContext) => Promise<unknown>;
type Tool = {
  name: string;
  execute: (
    callId: string,
    args: unknown,
    signal: undefined,
    update: undefined,
    context: ExtensionContext,
  ) => Promise<{ details: { message_ref: MessageReference } }>;
};

function session(
  role: "cos" | "manager",
  id: string = randomUUID(),
  entries: Entry[] = [],
  autoAccept = true,
) {
  process.env.AGENT_ROLE = role;
  const handlers = new Map<string, Handler>(),
    tools = new Map<string, Tool>(),
    messages: Delivery[] = [];
  const notices: string[] = [];
  const ctx = {
    sessionManager: { getSessionId: () => id, getBranch: () => entries },
    ui: {
      notify(message: string) {
        notices.push(message);
      },
    },
  } as unknown as ExtensionContext;
  const accept = async (message: Delivery) => {
    entries.push({
      type: "custom_message",
      customType: message.customType,
      content: message.content,
      details: message.details,
    });
    await handlers.get("message_start")?.({ message: { role: "custom", ...message } });
  };
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    sendMessage(message: Delivery) {
      messages.push(message);
      if (autoAccept) void accept(message);
    },
  };
  extension(pi as unknown as ExtensionAPI);
  return {
    id,
    pi,
    tools,
    ctx,
    messages,
    entries,
    accept,
    notices,
    settle: (outcome = "completed") =>
      handlers.get("agent_before_settle")!({ outcome }, ctx) as Promise<BoundaryResult | void>,
    execute: (name: string, args: unknown) =>
      tools.get(name)!.execute(randomUUID(), args, undefined, undefined, ctx),
    start: () => handlers.get("session_start")!({}, ctx),
    stop: () => handlers.get("session_shutdown")!(),
  };
}
const intent = (
  summary: string,
  recipient: "cos" | "manager" = "manager",
  expectation: Static<typeof SendArguments>["reply_expectation"] = null,
): Static<typeof SendArguments> => ({
  recipient,
  message_type: "chat",
  content: expectation ? requestContent(summary) : content(summary),
  reply_expectation: expectation,
});

test("final tool validation rejects oversized post-hook briefs before transport and retains bounded memory references", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const cos = session("cos");
  try {
    await cos.start();
    const args = intent("Compare low-maintenance calendar options", "manager", {
      window: "medium",
    });
    validate(SendArguments, args);
    args.content.context.push("x".repeat(4001));
    await assert.rejects(cos.execute("send_agent_message", args));
    assert.deepEqual(
      ok(await db.from("agent_messages").select("id").eq("conversation_id", cos.id)),
      [],
    );
    args.content.context = ["memory-context:ready; owner-confirmed low-maintenance constraint"];
    args.content.references.push({
      locator: `memory:${"a".repeat(64)}`,
      note: "Selected task context",
    });
    const sent = await cos.execute("send_agent_message", args);
    assert.deepEqual(
      (await row(sent.details.message_ref)).content.references,
      args.content.references,
    );
  } finally {
    await cos.stop();
    await cleanup([cos.id]);
  }
});

test("different Pi UUIDs communicate by role; JSON delivery, acceptance, replies and session changes", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const cos = session("cos"),
    lead = session("manager", randomUUID(), [], false),
    sessions = [cos, lead];
  const conversations = [cos.id];
  try {
    assert.notEqual(cos.id, lead.id);
    await cos.start();
    await lead.start();
    const sent = await cos.execute(
      "send_agent_message",
      intent("Technical question", "manager", { window: "medium" }),
    );
    const ref = sent.details.message_ref;
    await wait(() => lead.messages.some((message) => message.details.message_ref.id === ref.id));
    const delivered = lead.messages.find((message) => message.details.message_ref.id === ref.id);
    assert.ok(delivered);
    const envelope = JSON.parse(delivered.content) as {
      message_ref: MessageReference;
      in_reply_to: MessageReference | null;
      sender: string;
    };
    assert.deepEqual(envelope.message_ref, ref);
    assert.equal(envelope.in_reply_to, null);
    assert.equal(envelope.sender, "cos");
    assert.equal((await row(ref)).status, "created"); // Receipt alone is not read.
    await lead.accept(delivered);
    await wait(async () => (await row(ref)).status === "read");
    const answer = await lead.execute("reply_agent_message", {
      parent: ref,
      message_type: "chat",
      content: content("Technical answer"),
      reply_expectation: null,
    });
    assert.equal(answer.details.message_ref.conversation_id, cos.id);
    await wait(() =>
      cos.messages.some(
        (message) => message.details.message_ref.id === answer.details.message_ref.id,
      ),
    );
    assert.deepEqual(
      (JSON.parse(cos.messages.at(-1)!.content) as { in_reply_to: MessageReference }).in_reply_to,
      ref,
    );
    assert.equal((await row(ref)).status, "replied");
    await assert.rejects(() =>
      lead.execute("reply_agent_message", {
        parent: ref,
        message_type: "chat",
        content: content("Duplicate"),
        reply_expectation: null,
      }),
    );
    await cos.stop();
    const resumed = session("cos", cos.id, cos.entries);
    sessions.push(resumed);
    await resumed.start();
    assert.equal(resumed.messages.length, 0);
    // Change the active session: new root sends use its UUID, never a cached ID.
    const nextId = randomUUID();
    conversations.push(nextId);
    resumed.ctx.sessionManager.getSessionId = () => nextId;
    await resumed.start();
    const next = await resumed.execute("send_agent_message", intent("New session"));
    assert.equal(next.details.message_ref.conversation_id, nextId);
    assert.equal((await row(next.details.message_ref)).recipient, "manager");
  } finally {
    for (const item of sessions.reverse()) await item.stop();
    await cleanup(conversations);
  }
});

test("append-before-ack recovery and failed acknowledgement retry do not reinject mail", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const conversation = randomUUID();
  const stored = ok(
    await db
      .rpc("agent_mail_send", {
        p_sender_role: "cos",
        p_recipient_role: "manager",
        p_conversation_id: conversation,
        p_message_type: "chat",
        p_content: content("Recover me"),
        p_response_due_minutes: null,
      })
      .single<Message>(),
  );
  const ref = { conversation_id: conversation, id: stored.id };
  const originalFetch = globalThis.fetch;
  let failRead = true;
  globalThis.fetch = async (input, init) => {
    if (
      (input instanceof Request ? input.url : input.toString()).includes(
        "/functions/v1/agent-mail",
      ) &&
      typeof init?.body === "string" &&
      (JSON.parse(init.body) as { operation: string }).operation === "read" &&
      failRead
    ) {
      failRead = false;
      return Response.json({ error: "Temporary acknowledgement failure" }, { status: 500 });
    }
    return originalFetch(input, init);
  };
  const lead = session("manager", randomUUID(), [
    { type: "custom_message", customType: "agent-mail", details: { message_ref: ref } },
  ]);
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

test("complete reports cover original requirements, including after an initial progress reply", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const conversation = randomUUID(),
    lead = session("manager");
  const requirements = ["Retain the original task", "Do not create duplicate retry work"];
  const parent = ok(
    await db
      .rpc("agent_mail_send", {
        p_sender_role: "cos",
        p_recipient_role: "manager",
        p_conversation_id: conversation,
        p_message_type: "chat",
        p_content: requestContent("Implement retry behavior", requirements),
        p_response_due_minutes: 10,
      })
      .single<Message>(),
  );
  const ref = { conversation_id: conversation, id: parent.id };
  try {
    await lead.start();
    await wait(async () => (await row(ref)).status === "read");
    await assert.rejects(
      () =>
        lead.execute("reply_agent_message", {
          parent: ref,
          message_type: "chat",
          content: completedContent("Done", [requirements[0]]),
          reply_expectation: null,
        }),
      /Do not create duplicate retry work/,
    );
    assert.equal((await row(ref)).status, "read");
    const progress = await lead.execute("reply_agent_message", {
      parent: ref,
      message_type: "chat",
      content: content("Implementation started", {
        result: {
          state: "in_progress",
          accomplished: ["Reviewed the existing flow"],
          remaining: ["Implement and verify"],
          checks: [],
        },
      }),
      reply_expectation: null,
    });
    assert.equal(await lead.settle(), undefined); // Responding is not a completion claim.
    const followup = {
      recipient: "cos",
      message_type: "chat",
      reply_expectation: null,
      content: completedContent("Verified retry behavior", requirements),
    };
    // Linking the initial progress reply still resolves its original request.
    followup.content.related_messages = [progress.details.message_ref];
    const incomplete = {
      ...followup,
      content: { ...followup.content, result: completedContent("Done", [requirements[0]]).result },
    };
    await assert.rejects(
      () => lead.execute("send_agent_message", incomplete),
      /Do not create duplicate retry work/,
    );
    const report = await lead.execute("send_agent_message", followup);
    assert.equal((await row(report.details.message_ref)).content.result?.state, "complete");
  } finally {
    await lead.stop();
    await cleanup([lead.id, conversation]);
  }
});

test("required-reply guard corrects missing mail twice, reports failure, and recovers read requests", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const conversation = randomUUID(),
    lead = session("manager"),
    sessions = [lead];
  const parent = ok(
    await db
      .rpc("agent_mail_send", {
        p_sender_role: "cos",
        p_recipient_role: "manager",
        p_conversation_id: conversation,
        p_message_type: "chat",
        p_content: requestContent("Please investigate"),
        p_response_due_minutes: 10,
      })
      .single<Message>(),
  );
  const ref = { conversation_id: conversation, id: parent.id };
  try {
    await lead.start();
    await wait(async () => (await row(ref)).status === "read");
    assert.equal(await lead.settle("aborted"), undefined);
    for (let attempt = 0; attempt < 2; attempt++) {
      const boundary = await lead.settle();
      assert.equal(boundary?.continue, true);
      const entry = boundary?.entries?.[0];
      assert.ok(entry?.type === "custom_message" && typeof entry.content === "string");
      assert.match(entry.content, /reply_agent_message/);
    }
    assert.equal(await lead.settle(), undefined);
    assert.ok(lead.notices.some((notice) => notice.includes("two correction turns")));
    assert.equal((await row(ref)).status, "read");
    await lead.stop();
    // A new Pi session receives only unanswered read requests, not all old mail.
    const recovered = session("manager");
    sessions.push(recovered);
    await recovered.start();
    assert.equal(recovered.messages.length, 1);
    assert.equal((await recovered.settle())?.continue, true);
    await recovered.execute("reply_agent_message", {
      parent: ref,
      message_type: "chat",
      content: content("Here are the findings"),
      reply_expectation: null,
    });
    assert.equal(await recovered.settle(), undefined);
    assert.equal((await row(ref)).status, "replied");
  } finally {
    for (const item of sessions.reverse()) await item.stop();
    await cleanup([conversation]);
  }
});

test("ambiguous reply failures persist across restart and never trigger automatic write replay", async () => {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = secret;
  const conversation = randomUUID(),
    lead = session("manager"),
    sessions = [lead];
  const parent = ok(
    await db
      .rpc("agent_mail_send", {
        p_sender_role: "cos",
        p_recipient_role: "manager",
        p_conversation_id: conversation,
        p_message_type: "chat",
        p_content: requestContent("Investigate"),
        p_response_due_minutes: 10,
      })
      .single<Message>(),
  );
  const ref = { conversation_id: conversation, id: parent.id };
  const originalFetch = globalThis.fetch;
  const answer = {
    parent: ref,
    message_type: "chat",
    content: content("Findings"),
    reply_expectation: null,
  };
  let writes = 0;
  try {
    await lead.start();
    await wait(async () => (await row(ref)).status === "read");
    globalThis.fetch = async (input, init) => {
      if (
        (input instanceof Request ? input.url : input.toString()).includes(
          "/functions/v1/agent-mail",
        ) &&
        typeof init?.body === "string" &&
        (JSON.parse(init.body) as { operation: string }).operation === "reply"
      ) {
        writes++;
        return Response.json({ error: "Connection lost; delivery unknown" }, { status: 500 });
      }
      return originalFetch(input, init);
    };
    await assert.rejects(() => lead.execute("reply_agent_message", answer), /delivery unknown/);
    assert.equal(await lead.settle(), undefined);
    await lead.stop();
    const recovered = session("manager", lead.id, lead.entries);
    sessions.push(recovered);
    await recovered.start();
    assert.equal(await recovered.settle(), undefined);
    await assert.rejects(
      () => recovered.execute("reply_agent_message", answer),
      /delivery is uncertain/,
    );
    assert.equal(writes, 1);
    // Reconciliation recognizes a reply which eventually committed elsewhere.
    globalThis.fetch = originalFetch;
    ok<unknown>(
      await db.rpc("agent_mail_reply", {
        p_sender_role: "manager",
        p_parent_conversation_id: conversation,
        p_parent_id: ref.id,
        p_message_type: "chat",
        p_content: content("Findings"),
        p_response_due_minutes: null,
      }),
    );
    assert.equal(await recovered.settle(), undefined);
    assert.equal((await row(ref)).status, "replied");
  } finally {
    globalThis.fetch = originalFetch;
    for (const item of sessions.reverse()) await item.stop();
    await cleanup([conversation]);
  }
});
