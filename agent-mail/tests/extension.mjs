import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Set local Supabase URL and secret key");
const admin = createClient(url, secret, { auth: { persistSession: false } });
const ok = ({ data, error }) => { if (error) throw error; return data; };
const wait = async (predicate, attempts = 180) => {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for agent mail");
};

function session(id, entries = []) {
  const handlers = new Map(), messages = [];
  const pi = {
    on(name, fn) { handlers.set(name, fn); },
    registerTool(tool) { pi.tool = tool; },
    sendMessage(message) {
      messages.push(message);
      entries.push({ type: "custom_message", customType: message.customType, details: message.details });
      void handlers.get("message_start")?.({ message: { role: "custom", ...message } });
    },
  };
  const ctx = { sessionManager: { getSessionId: () => id, getEntries: () => entries }, ui: { notify() {} } };
  return { pi, messages, entries, start: () => handlers.get("session_start")({}, ctx),
    stop: () => handlers.get("session_shutdown")() };
}

test("two persistent Pi session adapters: mail, retry, replay, restart, chase", async () => {
  const sessions = [];
  const created = [];
  const pmId = "pm", leadId = "tech-lead";
  try {
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_SECRET_KEY = secret;
    process.env.AGENT_MAIL_DEADLINE_SECONDS = "1";
    process.env.AGENT_MAIL_CHASE_INTERVAL_SECONDS = "3600";
    ok(await admin.from("agent_mail_leases").delete().in("identity", [pmId, leadId]));
    process.env.AGENT_MAIL_IDENTITY = "pm";
    const pmExtension = (await import(`../index.ts?pm-${randomUUID()}`)).default;
    process.env.AGENT_MAIL_IDENTITY = "tech-lead";
    const leadExtension = (await import(`../index.ts?lead-${randomUUID()}`)).default;
    const pm = session(pmId), lead = session(leadId);
    pmExtension(pm.pi); leadExtension(lead.pi);
    sessions.push(pm, lead);
    await pm.start(); await lead.start();
    const A = await pm.pi.tool.execute("call-a", { recipient: "tech-lead", body: "Technical question" });
    const idA = A.details.id;
    created.push(idA);
    await wait(() => lead.messages.some((m) => m.details?.id === idA));
    await wait(async () => ok(await admin.from("agent_messages").select("status").eq("id", idA).single()).status === "read");
    const B = await lead.pi.tool.execute("call-b", { recipient: "pm", body: "Technical answer", in_reply_to: idA });
    const idB = B.details.id;
    created.push(idB);
    await wait(() => pm.messages.some((m) => m.details?.id === idB));
    assert.equal(ok(await admin.from("agent_messages").select("status").eq("id", idA).single()).status, "replied");
    const retry = await lead.pi.tool.execute("call-b", { recipient: "pm", body: "Technical answer", in_reply_to: idA });
    assert.equal(retry.details.id, idB);
    assert.equal(ok(await admin.from("agent_messages").select("id").eq("in_reply_to", idA)).length, 1);
    // Simulate a repeated Realtime wake-up by replaying reconciliation through a second startup.
    await pm.stop();
    const resumed = session(pmId, pm.entries);
    pmExtension(resumed.pi);
    sessions.push(resumed);
    await resumed.start();
    assert.equal(resumed.messages.filter((m) => m.details?.id === idB).length, 0);
    const C = await resumed.pi.tool.execute("call-c", { recipient: "tech-lead", body: "Pending on restart" });
    created.push(C.details.id);
    await lead.stop();
    const restarted = session(leadId, lead.entries);
    leadExtension(restarted.pi);
    sessions.push(restarted);
    await restarted.start();
    await wait(() => restarted.messages.some((m) => m.details?.id === C.details.id));
    const D = await resumed.pi.tool.execute("call-d", { recipient: "tech-lead", body: "Overdue" });
    created.push(D.details.id);
    await wait(async () => {
      const result = ok(await botsRead(resumed, D.details.id));
      return result === "read";
    });
    await wait(() => resumed.messages.some((m) => m.customType === "agent-mail-chase" &&
      m.details?.message_id === D.details.id), 130);
    await resumed.stop();
    const pmRestarted = session(pmId, resumed.entries);
    pmExtension(pmRestarted.pi);
    sessions.push(pmRestarted);
    await pmRestarted.start();
    assert.equal(pmRestarted.messages.filter((m) => m.customType === "agent-mail-chase" &&
      m.details?.message_id === D.details.id).length, 0);
  } finally {
    for (const item of sessions.reverse()) await item.stop();
    if (created.length) {
      ok(await admin.from("agent_mail_chases").delete().in("message_id", created));
      for (const id of created.reverse()) ok(await admin.from("agent_messages").delete().eq("id", id));
    }
    ok(await admin.from("agent_mail_leases").delete().in("identity", [pmId, leadId]));
  }
});

async function botsRead(_session, id) {
  return admin.from("agent_messages").select("status").eq("id", id).single().then(({ data, error }) => ({ data: data?.status, error }));
}
