import { randomUUID } from "node:crypto";
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { Type, type TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  envelope,
  mailTools,
  MessageRef,
  reference,
  referenceKey,
  replyRequest,
  Role,
  sendRequest,
  StoredMessage,
  validate,
  validateCoverage,
  validateReceivedMessage,
  type Message,
  type MessageReference,
} from "./schemas.ts";
import { isWorkerResult } from "./worker-result.ts";

class UncertainWriteError extends Error {}

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
  const log = (event: string, error?: unknown) =>
    console.error(
      `[agent-mail:${role}] ${event}${error ? `: ${error instanceof Error ? error.message : JSON.stringify(error)}` : ""}`,
    );
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
  const deliveryRows = new Map<string, Message>();
  const obligations = new Map<string, Message>();
  const corrections = new Map<string, number>();
  const uncertain = new Set<string>();
  const reported = new Set<string>();
  const maxCorrections = 2;

  const inSession = (ref: MessageReference) =>
    ctx?.sessionManager.getBranch().some((entry) => {
      if (entry.type !== "custom_message" || entry.customType !== "agent-mail") return false;
      const details = entry.details as { message_ref?: unknown } | undefined;
      try {
        return referenceKey(validate(MessageRef, details?.message_ref)) === referenceKey(ref);
      } catch {
        return false;
      }
    }) ?? false;

  async function invoke(body: Record<string, unknown>, signal?: AbortSignal) {
    if (!db || !live) throw new Error("Agent mail is disconnected");
    let result;
    try {
      result = await db.functions.invoke("agent-mail", { body, signal });
    } catch (error) {
      throw new UncertainWriteError(String(error));
    }
    if (result.error) {
      // Do not automatically retry writes: idempotency was intentionally removed.
      const response = (result.error as { context?: unknown }).context;
      if (response instanceof Response) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (payload?.error)
          throw response.status >= 500
            ? new UncertainWriteError(payload.error)
            : new Error(payload.error);
      }
      const error: unknown = result.error;
      throw new UncertainWriteError(error instanceof Error ? error.message : JSON.stringify(error));
    }
    try {
      return unwrap(result.data as { data: unknown; error: null });
    } catch (error) {
      throw new UncertainWriteError(String(error));
    }
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
    if (running) {
      pending = true;
      return;
    }
    running = true;
    const token = generation;
    try {
      for (const ref of accepted.values()) {
        try {
          await acknowledge(ref, token);
        } catch (error) {
          log("Read acknowledgement retry failed", error);
        }
        if (!live || token !== generation) return;
      }
      // Fetch before delivery changes statuses; read requests must not starve new mail.
      const rows: Message[] = [];
      for (let offset = 0; ; offset += 20) {
        const page = validate(
          Type.Array(StoredMessage),
          unwrap(
            await db
              .from("agent_messages")
              .select("*")
              .eq("recipient", role)
              .or("status.eq.created,and(status.eq.read,response_due.not.is.null)")
              .order("created_at")
              .order("conversation_id")
              .order("id")
              .range(offset, offset + 19),
          ),
        );
        for (const row of page) {
          if (isWorkerResult(row.content)) {
            try {
              validateReceivedMessage(row);
            } catch (error) {
              log("Invalid worker result", error);
              continue;
            }
          }
          rows.push(row);
        }
        if (!live || token !== generation) return;
        if (page.length < 20) break;
      }
      if (!live || token !== generation) return;
      for (const row of rows) {
        if (!live || token !== generation) break;
        const ref = reference(row),
          key = referenceKey(ref);
        if (row.status === "read" && row.response_due !== null) obligations.set(key, row);
        if (delivering.has(key) || acknowledged.has(key) || accepted.has(key)) continue;
        if (inSession(ref)) {
          if (row.response_due !== null) obligations.set(key, row);
          accepted.set(key, ref);
          try {
            await acknowledge(ref, token);
          } catch (error) {
            log("Recovery acknowledgement failed", error);
          }
          continue;
        }
        delivering.add(key);
        deliveryRows.set(key, row);
        try {
          pi.sendMessage(
            {
              customType: "agent-mail",
              content: JSON.stringify(envelope(row)),
              display: true,
              details: { message_ref: ref },
            },
            { triggerTurn: true, deliverAs: "followUp" },
          );
        } catch (error) {
          delivering.delete(key);
          deliveryRows.delete(key);
          log("Delivery failed", error);
        }
      }
    } catch (error) {
      if (live) log("Reconciliation failed", error);
    } finally {
      running = false;
      if (pending && live) {
        pending = false;
        queueMicrotask(() => void reconcile());
      }
    }
  }

  // Pi appends custom messages before message_start. Never mark read on socket receipt.
  pi.on("message_start", async (event) => {
    if (event.message.role !== "custom" || event.message.customType !== "agent-mail" || !live)
      return;
    const ref = validate(
      MessageRef,
      (event.message.details as { message_ref?: unknown } | undefined)?.message_ref,
    );
    const key = referenceKey(ref);
    if (!delivering.has(key)) return;
    const token = generation;
    const row = deliveryRows.get(key);
    if (row && row.response_due !== null) obligations.set(key, row);
    deliveryRows.delete(key);
    delivering.delete(key);
    accepted.set(key, ref);
    try {
      await acknowledge(ref, token);
    } catch (error) {
      log("Read acknowledgement failed; will retry", error);
    }
  });

  async function submit(
    name: string,
    args: unknown,
    context: ExtensionContext,
    signal?: AbortSignal,
  ) {
    const agent = {
      role,
      sessionId: validate(
        MessageRef.properties.conversation_id,
        context.sessionManager.getSessionId(),
      ),
    };
    const request =
      name === "send_agent_message" ? sendRequest(agent, args) : replyRequest(agent, args);
    if (!db) throw new Error("Agent mail is disconnected");
    const cache = new Map<string, Message>();
    const load = async (ref: MessageReference): Promise<Message> => {
      const key = referenceKey(ref);
      if (cache.has(key)) return cache.get(key)!;
      const message = validate(
        StoredMessage,
        unwrap(
          await db!
            .from("agent_messages")
            .select("*")
            .eq("conversation_id", ref.conversation_id)
            .eq("id", ref.id)
            .single(),
        ),
      );
      cache.set(key, message);
      return message;
    };
    const parent = "parent" in request ? await load(request.parent) : null;
    if (parent && isWorkerResult(parent.content))
      throw new Error("Cannot reply to receive-only worker results; replies are PM/TL only");
    if (parent && (parent.recipient !== role || parent.status !== "read")) {
      throw new Error(
        "Reply parent is not addressed to this role, not accepted, or already answered",
      );
    }
    const recipient = "recipient_role" in request ? request.recipient_role : parent!.sender;
    const refs = [
      ...request.content.related_messages,
      ...("parent" in request ? [request.parent] : []),
    ];
    const requests = [];
    for (const ref of refs) {
      let cursor: MessageReference | null = ref;
      const seen = new Set<string>();
      while (cursor && !seen.has(referenceKey(cursor))) {
        seen.add(referenceKey(cursor));
        const message = await load(cursor);
        if (isWorkerResult(message.content))
          throw new Error("related_messages must reference PM/TL exchanges, not worker results");
        if (!(
          (message.sender === role && message.recipient === recipient) ||
          (message.sender === recipient && message.recipient === role)
        )) {
          throw new Error(
            "related_messages must reference an existing exchange between these participants",
          );
        }
        if (request.content.result?.state !== "complete") break;
        if (message.recipient === role && message.content.request !== null) {
          requests.push(message.content);
          break;
        }
        cursor =
          message.in_reply_to === null
            ? null
            : { conversation_id: message.conversation_id, id: message.in_reply_to };
      }
    }
    validateCoverage(request.content, requests);
    const parentKey = "parent" in request ? referenceKey(request.parent) : undefined;
    if (parentKey && uncertain.has(parentKey))
      throw new Error(
        "Previous reply delivery is uncertain; reconcile or escalate before another write",
      );
    // Persist before the write: a crash before receiving its result is also ambiguous.
    if (parentKey) {
      uncertain.add(parentKey);
      pi.appendEntry("agent-mail-uncertain", {
        parent: "parent" in request ? request.parent : null,
        resolved: false,
      });
    }
    let row: Message;
    try {
      const response = await invoke(request, signal);
      try {
        row = validate(StoredMessage, response);
      } catch (error) {
        throw new UncertainWriteError(
          `Stored mail response could not be validated: ${String(error)}`,
        );
      }
    } catch (error) {
      if (parentKey && !(error instanceof UncertainWriteError)) {
        uncertain.delete(parentKey);
        pi.appendEntry("agent-mail-uncertain", {
          parent: "parent" in request ? request.parent : null,
          resolved: true,
        });
      }
      throw error;
    }
    if (parentKey) {
      obligations.delete(parentKey);
      corrections.delete(parentKey);
      uncertain.delete(parentKey);
      pi.appendEntry("agent-mail-uncertain", {
        parent: "parent" in request ? request.parent : null,
        resolved: true,
      });
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope(row)) }],
      details: { message_ref: reference(row), status: row.status, response_due: row.response_due },
    };
  }
  for (const tool of mailTools) {
    pi.registerTool<TSchema>({
      ...tool,
      label: tool.name === "send_agent_message" ? "Send agent mail" : "Reply to agent mail",
      promptSnippet:
        "Send or reply with the shared structured JSON contract; ordinary text does not send mail.",
      promptGuidelines: [
        "Answer incoming mail that expects a response with reply_agent_message. State an honest conclusion, clarification or progress; never invent completion evidence.",
      ],
      async execute(_callId, args, signal, _onUpdate, context) {
        return submit(tool.name, args, context, signal);
      },
    });
  }

  pi.on("agent_before_settle", async (event, context) => {
    if (!live || !db || event.outcome !== "completed") return;
    const token = generation;
    const reminders: Message[] = [];
    for (const [key, message] of obligations) {
      // A transport error can occur after a committed reply. Never blindly replay it.
      let current: Message;
      try {
        current = validate(
          StoredMessage,
          unwrap(
            await db
              .from("agent_messages")
              .select("*")
              .eq("conversation_id", message.conversation_id)
              .eq("id", message.id)
              .single(),
          ),
        );
      } catch (error) {
        log("Cannot reconcile required reply", error);
        if (!reported.has(key)) {
          context.ui.notify(
            "Agent mail reply state could not be verified; unresolved mail remains pending",
            "error",
          );
          reported.add(key);
        }
        continue;
      }
      if (!live || token !== generation) return;
      if (current.status === "replied") {
        obligations.delete(key);
        uncertain.delete(key);
        corrections.delete(key);
        continue;
      }
      if (current.status !== "read") continue; // Never ask for a reply before acceptance/acknowledgement.
      if (uncertain.has(key) || (corrections.get(key) ?? 0) >= maxCorrections) {
        if (!reported.has(key)) {
          const reason = uncertain.has(key)
            ? "Previous reply delivery is uncertain"
            : "Agent did not send a required reply after two correction turns";
          context.ui.notify(
            `${reason}: ${key}. Keep this request unresolved and escalate the communication blocker.`,
            "error",
          );
          pi.appendEntry("agent-mail-reply-failure", { message_ref: reference(current), reason });
          reported.add(key);
        }
        continue;
      }
      if (reminders.length < 5) {
        corrections.set(key, (corrections.get(key) ?? 0) + 1);
        reminders.push(current);
      }
    }
    if (!reminders.length) return;
    return {
      continue: true,
      entries: [
        {
          type: "custom_message" as const,
          customType: "agent-mail-reply-required",
          display: true,
          content: `These accepted messages require a stored reply. Use reply_agent_message with each message_ref as parent and the shared content schema. Ordinary assistant text does not send mail. Give a supported answer, focused clarification, or honest progress; do not fabricate work or evidence.\n${JSON.stringify(reminders.map(envelope))}`,
          details: { message_refs: reminders.map(reference) },
        },
      ],
    };
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
    delivering.clear();
    accepted.clear();
    acknowledged.clear();
    deliveryRows.clear();
    obligations.clear();
    corrections.clear();
    uncertain.clear();
    reported.clear();
  }
  pi.on("session_start", async (_event, context) => {
    if (live) await stop();
    ctx = context;
    generation++;
    for (const entry of context.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== "agent-mail-uncertain") continue;
      try {
        const data = entry.data as { parent?: unknown; resolved?: boolean };
        const key = referenceKey(validate(MessageRef, data?.parent));
        if (data.resolved) uncertain.delete(key);
        else uncertain.add(key);
      } catch {
        /* Ignore unrelated or malformed historical extension metadata. */
      }
    }
    try {
      validate(MessageRef.properties.conversation_id, context.sessionManager.getSessionId());
      db = createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      live = true;
      channel = db
        .channel(`agent-mail-${role}-${randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "agent_messages",
            filter: `recipient=eq.${role}`,
          },
          () => void reconcile(),
        )
        .subscribe((state) => {
          if (state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) void reconcile();
        });
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
