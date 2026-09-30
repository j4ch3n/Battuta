import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Type, type TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeMailIntent } from "./completion.ts";
import { envelope, mailTools, MessageRef, reference, referenceKey, replyRequest, Role,
  sendRequest, StoredMessage, validate, type MessageReference } from "./schemas.ts";

const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};
const unwrap = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("Empty Supabase response");
  return result.data;
};

export default function (pi: ExtensionAPI) {
  const role = validate(Role, required("AGENT_ROLE"));
  const log = (event: string, error?: unknown) => console.error(`[agent-mail:${role}] ${event}${error ? `: ${String(error)}` : ""}`);
  let db: SupabaseClient | undefined;
  let ctx: ExtensionContext | undefined;
  let live = false;
  let generation = 0;
  let channel: ReturnType<SupabaseClient["channel"]> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let pending = false;
  const delivering = new Set<string>();
  const accepted = new Map<string, MessageReference>();
  const acknowledged = new Set<string>();

  const inSession = (ref: MessageReference) => ctx?.sessionManager.getBranch().some((entry) => {
    if (entry.type !== "custom_message" || entry.customType !== "agent-mail") return false;
    const details = entry.details as { message_ref?: unknown } | undefined;
    try { return referenceKey(validate(MessageRef, details?.message_ref)) === referenceKey(ref); }
    catch { return false; }
  }) ?? false;

  async function invoke(body: Record<string, unknown>, signal?: AbortSignal) {
    if (!db || !live) throw new Error("Agent mail is disconnected");
    const result = await db.functions.invoke("agent-mail", { body, signal });
    if (result.error) {
      // Do not automatically retry writes: idempotency was intentionally removed.
      const response = (result.error as { context?: unknown }).context;
      if (response instanceof Response) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (payload?.error) throw new Error(payload.error);
      }
      throw new Error(result.error.message);
    }
    return unwrap(result.data as { data: unknown; error: null });
  }

  async function acknowledge(ref: MessageReference, token: number) {
    await invoke({ operation: "read", recipient_role: role, message_ref: ref });
    if (token !== generation || !live) return;
    const key = referenceKey(ref);
    accepted.delete(key);
    acknowledged.add(key);
    log(`Pi accepted ${key}`);
  }

  async function reconcile() {
    if (!live || !db) return;
    if (running) { pending = true; return; }
    running = true;
    const token = generation;
    try {
      for (const ref of accepted.values()) {
        try { await acknowledge(ref, token); }
        catch (error) { log("Read acknowledgement retry failed", error); }
        if (!live || token !== generation) return;
      }
      const rows = validate(Type.Array(StoredMessage), unwrap(await db.from("agent_messages").select("*")
        .eq("recipient", role).eq("status", "created").order("created_at").order("conversation_id").order("id").limit(20)));
      if (!live || token !== generation) return;
      for (const row of rows) {
        if (!live || token !== generation) break;
        const ref = reference(row), key = referenceKey(ref);
        if (delivering.has(key) || acknowledged.has(key) || accepted.has(key)) continue;
        if (inSession(ref)) {
          accepted.set(key, ref);
          try { await acknowledge(ref, token); }
          catch (error) { log("Recovery acknowledgement failed", error); }
          continue;
        }
        delivering.add(key);
        try {
          pi.sendMessage({ customType: "agent-mail", content: JSON.stringify(envelope(row)), display: true,
            details: { message_ref: ref } }, { triggerTurn: true, deliverAs: "followUp" });
        } catch (error) { delivering.delete(key); log("Delivery failed", error); }
      }
    } catch (error) { if (live) log("Reconciliation failed", error); }
    finally {
      running = false;
      if (pending && live) { pending = false; queueMicrotask(() => void reconcile()); }
    }
  }

  // Pi appends custom messages before message_start. Never mark read on socket receipt.
  pi.on("message_start", async (event) => {
    if (event.message.role !== "custom" || event.message.customType !== "agent-mail" || !live) return;
    const ref = validate(MessageRef, (event.message.details as { message_ref?: unknown } | undefined)?.message_ref);
    const key = referenceKey(ref);
    if (!delivering.has(key)) return;
    const token = generation;
    delivering.delete(key);
    accepted.set(key, ref);
    try { await acknowledge(ref, token); }
    catch (error) { log("Read acknowledgement failed; will retry", error); }
  });

  async function submit(name: string, args: unknown, context: ExtensionContext, signal?: AbortSignal) {
    const agent = { role, sessionId: validate(MessageRef.properties.conversation_id, context.sessionManager.getSessionId()) };
    const request = name === "send_agent_message" ? sendRequest(agent, args) : replyRequest(agent, args);
    const row = validate(StoredMessage, await invoke(request, signal));
    return { content: [{ type: "text" as const, text: JSON.stringify(envelope(row)) }],
      details: { message_ref: reference(row), status: row.status, response_due: row.response_due } };
  }
  for (const tool of mailTools) {
    pi.registerTool<TSchema>({ ...tool, label: tool.name === "send_agent_message" ? "Send agent mail" : "Reply to agent mail",
      async execute(_callId, args, signal, _onUpdate, context) { return submit(tool.name, args, context, signal); } });
  }

  // Direct complete-API entry point. Normal agent tool calls already contain the
  // typed intent and do not run another completion inside their thin wrappers.
  pi.registerCommand("agent-mail", {
    description: "Compose and send one typed agent message from an instruction",
    async handler(instruction, context) {
      if (!instruction.trim()) throw new Error("Provide an agent-mail instruction");
      const incoming = context.sessionManager.getBranch().flatMap((entry) =>
        entry.type === "custom_message" && entry.customType === "agent-mail" && typeof entry.content === "string" ? [entry.content] : []).slice(-20);
      const intent = await completeMailIntent(context, instruction, incoming, role);
      const result = await submit(intent.name, intent.args, context);
      context.ui.notify(result.content[0].text, "info");
    },
  });

  async function stop() {
    live = false;
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (channel && db) await db.removeChannel(channel);
    channel = undefined;
    db = undefined;
    ctx = undefined;
    delivering.clear(); accepted.clear(); acknowledged.clear();
  }
  pi.on("session_start", async (_event, context) => {
    if (live) await stop();
    ctx = context;
    generation++;
    try {
      validate(MessageRef.properties.conversation_id, context.sessionManager.getSessionId());
      db = createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"),
        { auth: { persistSession: false, autoRefreshToken: false } });
      live = true;
      channel = db.channel(`agent-mail-${role}-${randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: `recipient=eq.${role}` }, () => void reconcile())
        .subscribe((state) => { if (state === "SUBSCRIBED") void reconcile(); });
      timer = setInterval(() => void reconcile(), 10_000);
      await reconcile();
    } catch (error) {
      await stop();
      log("Startup failed", error);
      context.ui.notify("Agent mail unavailable; check credentials and Supabase", "error");
    }
  });
  pi.on("session_shutdown", stop);
}
