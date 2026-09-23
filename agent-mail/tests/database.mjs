import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY for local tests");
const db = createClient(url, secret, { auth: { persistSession: false } });
const ok = ({ data, error }) => { if (error) throw error; return data; };

test("session-addressed reply invariants, idempotency, reconciliation, and overdue claims", async (t) => {
  const pm = "pm", lead = "tech-lead", created = [];
  const send = (sender, recipient, body, key, parent = null) => db.rpc("agent_mail_send_session",
    { p_sender: sender, p_recipient: recipient, p_body: body, p_key: key, p_in_reply_to: parent });
  const lease = (session, owner, release = false) => db.rpc("agent_mail_lease_session",
    { p_session: session, p_owner: owner, p_release: release });
  const read = (session, id, owner) => db.rpc("agent_mail_read_session",
    { p_session: session, p_id: id, p_owner: owner });
  const due = () => db.rpc("agent_mail_due_session",
    { p_session: pm, p_deadline_seconds: 1, p_interval_seconds: 3600 });
  try {
    ok(await db.from("agent_mail_leases").delete().in("identity", [pm, lead]));
    const key = randomUUID();
    const A = ok(await send(pm, lead, "Question", key));
    created.push(A.id);
    assert.equal(A.status, "created");
    assert.equal(ok(await send(pm, lead, "Question", key)).id, A.id);
    assert.ok((await send(pm, lead, "changed", key)).error);
    assert.ok((await send(pm, pm, "self-send", randomUUID())).error);
    assert.ok((await send("invalid session!", lead, "invalid sender", randomUUID())).error);
    assert.ok((await send(lead, pm, "premature reply", randomUUID(), A.id)).error);
    const owner = randomUUID();
    assert.equal(ok(await lease(lead, owner)), true);
    assert.equal(ok(await read(lead, A.id, owner)), true);
    assert.equal(ok(await read(lead, A.id, owner)), false);
    assert.ok((await read(pm, A.id, owner)).error); // different lease cannot acknowledge
    const B = ok(await send(lead, pm, "Answer", randomUUID(), A.id));
    created.push(B.id);
    assert.equal(B.sender, lead);
    assert.equal(B.recipient, pm);
    assert.equal(B.in_reply_to, A.id);
    assert.equal(B.conversation_id, A.conversation_id);
    assert.equal(ok(await db.from("agent_messages").select("status").eq("id", A.id).single()).status, "replied");
    assert.ok((await send(lead, pm, "second reply", randomUUID(), A.id)).error);
    const C = ok(await send(pm, lead, "Still waiting", randomUUID()));
    created.push(C.id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok(ok(await due()).some((item) => item.message_id === C.id && item.current_status === "created"));
    assert.ok(!ok(await due()).some((item) => item.message_id === C.id));
    ok(await lease(lead, owner, true));
    await t.test("recipient restart reconciles created rows", async () => {
      const restarted = randomUUID();
      assert.equal(ok(await lease(lead, restarted)), true);
      assert.ok(ok(await db.from("agent_messages").select("id").eq("recipient", lead).eq("status", "created"))
        .some((row) => row.id === C.id));
      assert.equal(ok(await read(lead, C.id, restarted)), true);
      ok(await lease(lead, restarted, true));
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok(ok(await due()).some((item) => item.message_id === C.id && item.current_status === "read"));
  } finally {
    if (created.length) {
      ok(await db.from("agent_mail_chases").delete().in("message_id", created));
      for (const id of created.reverse()) ok(await db.from("agent_messages").delete().eq("id", id));
    }
    ok(await db.from("agent_mail_leases").delete().in("identity", [pm, lead]));
  }
});
