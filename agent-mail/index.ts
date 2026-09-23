import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Identity = "pm" | "tech-lead";
type Message = { id: string; sender: string; recipient: string; body: string; status: string;
  conversation_id: string; in_reply_to: string | null; created_at: string };
const identity = process.env.AGENT_MAIL_IDENTITY as Identity;
if (identity !== "pm" && identity !== "tech-lead") throw new Error("Set AGENT_MAIL_IDENTITY to pm or tech-lead");
const peer: Identity = identity === "pm" ? "tech-lead" : "pm";
const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};
const log = (event: string, id?: string, error?: unknown) =>
  console.error(`[agent-mail:${identity}] ${event}${id ? ` ${id}` : ""}${error ? `: ${String(error)}` : ""}`);
const unwrap = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("empty Supabase response");
  return result.data;
};
export default function (pi: ExtensionAPI) {
  let db: SupabaseClient | undefined;
  let ctx: ExtensionContext | undefined;
  let sessionId = "";
  let peerSessionId = "";
  let live = false;
  let owner = randomUUID();
  const keyFor = (callId: string): string => {
    const hex = createHash("sha256").update(`${sessionId}:${owner}:${callId}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  let channel: ReturnType<SupabaseClient["channel"]> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let pending = false;
  const delivering = new Set<string>();
  const acknowledged = new Set<string>();
  const inSession = (id: string) => ctx?.sessionManager.getEntries().some((entry) =>
    entry.type === "custom_message" && entry.customType === "agent-mail" &&
    (entry.details as { id?: string } | undefined)?.id === id) ?? false;
  const deadline = Number(process.env.AGENT_MAIL_DEADLINE_SECONDS || "3600");
  const chaseInterval = Number(process.env.AGENT_MAIL_CHASE_INTERVAL_SECONDS || "3600");
  if (!Number.isInteger(deadline) || deadline < 1 || !Number.isInteger(chaseInterval) || chaseInterval < 1)
    throw new Error("Agent mail deadlines must be positive seconds");

  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const client = db;
    if (!client) throw new Error("Agent mail is disconnected");
    return unwrap((await client.rpc(name, args)) as { data: T | null; error: { message: string } | null });
  };

  async function reconcile() {
    if (!live || !db || running) { pending = true; return; }
    running = true;
    try {
      const leased = await rpc<boolean>("agent_mail_lease_session", { p_session: sessionId, p_owner: owner });
      if (!live) return;
      if (!leased) { log("inbox owned by another process"); return; }
      const rows = unwrap((await db.from("agent_messages").select("*")
        .eq("recipient", sessionId).eq("status", "created").order("created_at").limit(20)) as {
          data: Message[] | null; error: { message: string } | null });
      for (const row of rows) {
        if (!live || delivering.has(row.id) || acknowledged.has(row.id)) continue;
        if (row.recipient !== sessionId || row.sender !== peerSessionId || row.status !== "created") continue;
        if (inSession(row.id)) {
          try { await rpc("agent_mail_read_session", { p_session: sessionId, p_id: row.id, p_owner: owner }); acknowledged.add(row.id); log("recovered session acceptance", row.id); }
          catch (error) { log("recovery acknowledgement failed", row.id, error); }
          continue;
        }
        delivering.add(row.id);
        log("delivery attempt", row.id);
        try {
          pi.sendMessage({
            customType: "agent-mail",
            content: `Agent mail from ${row.sender}\nMessage ID: ${row.id}\nConversation ID: ${row.conversation_id}\nReply target: ${row.in_reply_to ?? "none"}\n\n${row.body}\n\nIf an answer is needed, call send_agent_message with recipient ${row.sender} and in_reply_to ${row.id}.`,
            display: true,
            details: { id: row.id, conversationId: row.conversation_id, inReplyTo: row.in_reply_to },
          }, { triggerTurn: true, deliverAs: "followUp" });
        } catch (error) { delivering.delete(row.id); log("delivery failed", row.id, error); }
      }
      if (live && identity === "pm") {
        const due = await rpc<{ message_id: string; elapsed_seconds: number; current_status: string }[]>(
          "agent_mail_due_session", { p_session: sessionId, p_deadline_seconds: deadline, p_interval_seconds: chaseInterval });
        for (const item of due) {
          if (!live) break;
          pi.sendMessage({ customType: "agent-mail-chase", display: true,
            content: `Agent mail follow-up: PM message ${item.message_id} is ${item.current_status === "created" ? "not yet received" : "read but unanswered"} after ${item.elapsed_seconds} seconds. Check status and either follow up with send_agent_message or tell the human about a persistent blocker.`,
            details: item }, { triggerTurn: true, deliverAs: "followUp" });
        }
      }
    } catch (error) { if (live) log("reconciliation failed", undefined, error); }
    finally {
      running = false;
      if (pending && live) { pending = false; queueMicrotask(() => void reconcile()); }
    }
  }

  // Pi 0.87 appends custom messages before emitting message_start. This is the
  // strongest observable session acceptance boundary; a crash between append and
  // DB acknowledgement can replay after restart. Never mark read on socket receipt.
  pi.on("message_start", async (event) => {
    const message = event.message;
    if (message.role !== "custom" || message.customType !== "agent-mail") return;
    const id = (message.details as { id?: string } | undefined)?.id;
    if (!id || !delivering.has(id) || !live) return;
    acknowledged.add(id);
    try { await rpc("agent_mail_read_session", { p_session: sessionId, p_id: id, p_owner: owner }); log("session accepted", id); }
    catch (error) { log("read acknowledgement failed", id, error); }
    finally { delivering.delete(id); }
  });

  pi.registerTool({
    name: "send_agent_message",
    label: "Send agent mail",
    description: "Send to the other bot's session ID or role (pm / tech-lead). Reply with in_reply_to when answering agent mail. Keep the returned message ID; reuse the same idempotency_key UUID when retrying unchanged content.",
    parameters: Type.Object({
      recipient: Type.String({ minLength: 2 }),
      body: Type.String({ minLength: 1, maxLength: 16000 }),
      in_reply_to: Type.Optional(Type.String({ format: "uuid" })),
      idempotency_key: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(callId, args) {
      if (!db || !sessionId) throw new Error("Agent mail is not connected");
      if (args.recipient !== peer && args.recipient !== peerSessionId) throw new Error("Unknown agent-mail recipient");
      const row = await rpc<Message>("agent_mail_send_session", {
        p_sender: sessionId, p_recipient: peerSessionId, p_body: args.body,
        p_in_reply_to: args.in_reply_to ?? null, p_key: args.idempotency_key ?? keyFor(callId),
      });
      log("sent", row.id);
      return { content: [{ type: "text", text: `Stored message ${row.id} in conversation ${row.conversation_id} (status ${row.status}). Retry key: ${args.idempotency_key ?? keyFor(callId)}` }],
        details: { id: row.id, conversationId: row.conversation_id, status: row.status } };
    },
  });

  pi.on("session_start", async (_event, context) => {
    if (live) return;
    ctx = context;
    owner = randomUUID();
    try {
      sessionId = context.sessionManager.getSessionId();
      if (sessionId !== identity) throw new Error("Pi session ID does not match configured runner identity");
      peerSessionId = peer;
      db = createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"),
        { auth: { persistSession: false, autoRefreshToken: false } });
      live = true;
      channel = db.channel(`agent-mail-${identity}-${owner}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: `recipient=eq.${sessionId}` },
          () => void reconcile())
        .subscribe((state) => { log(`subscription ${state}`); if (state === "SUBSCRIBED") void reconcile(); });
      timer = setInterval(() => void reconcile(), 10_000);
      await reconcile();
    } catch (error) { log("startup failed", undefined, error); ctx?.ui.notify("Agent mail unavailable; check credentials and Supabase", "error"); }
  });

  pi.on("session_shutdown", async () => {
    live = false;
    if (timer) clearInterval(timer);
    if (channel && db) await db.removeChannel(channel);
    if (db) {
      try { await rpc("agent_mail_lease_session", { p_session: sessionId, p_owner: owner, p_release: true }); } catch (error) { log("lease release failed", undefined, error); }
    }
    db = undefined;
    sessionId = "";
    peerSessionId = "";
    ctx = undefined;
    delivering.clear();
    acknowledged.clear();
  });
}
