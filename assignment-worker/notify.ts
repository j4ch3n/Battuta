import type { SupabaseClient } from "@supabase/supabase-js";
import { Content, validate, type MessageReference } from "@battuta/agent-mail/schemas";
import { MAX_BODY_LENGTH, validateContent, type MessageContent } from "@battuta/agent-mail/content";
import { sendProgrammaticMail, UncertainWriteError } from "@battuta/agent-mail/transport";
import type { Detail, ExecutionSessions, MailDelivery } from "./types.ts";

function brief(value: string, limit = 300) {
  const chars = Array.from(value);
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : value;
}

export function buildManagerContent(detail: Detail): MessageContent {
  const a = detail.assignment;
  if (a.status !== "done" && a.status !== "blocked")
    throw new Error("Only persisted done/blocked outcomes can be reported");
  const blocked = a.status === "blocked";
  const todos = [...detail.todos].sort((left, right) => left.position - right.position);
  const done = todos.filter((todo) => todo.status === "done");
  const unfinished = todos.filter((todo) => !["done", "cancelled"].includes(todo.status));
  if (!blocked && (!todos.length || unfinished.length))
    throw new Error("Recorded completion must have a nonempty terminal TODO set");
  const evidence = [...new Set(todos.flatMap((todo) => todo.evidence))].slice(0, 10);
  const lines = [
    `assignment_id: ${a.id}. Claim version: ${a.claimed_at ?? "not recorded"}. Outcomes and evidence are worker-reported, not Manager verification or owner acceptance; read each TODO's full outcome and evidence in the assignment with the exact project name.`,
    ...(blocked
      ? unfinished
          .slice(0, 8)
          .map((todo) => brief(`TODO ${todo.position} (${todo.status}): ${todo.description}`))
      : []),
    ...(done.length
      ? done.slice(0, 10).map((todo) => brief(`TODO ${todo.position}: ${todo.outcome}`))
      : blocked
        ? []
        : [
            "Recorded assignment closed with every TODO cancelled; no completed implementation is claimed.",
          ]),
    ...(evidence.length ? [`Evidence: ${evidence.map((e) => brief(e, 200)).join("; ")}`] : []),
  ];
  const content: MessageContent = {
    project: a.project,
    objective: brief(`Assignment ${a.id} ${blocked ? "blocked" : "completed"}: ${a.goal}`, 800),
    // brief counts code points; each is at most two UTF-16 units.
    body: brief(lines.join("\n"), MAX_BODY_LENGTH / 2),
    result: {
      state: blocked ? "blocked" : "complete",
      checks: [],
      ...(blocked
        ? { blocker: brief(a.blocker ?? "Inspect the authoritative assignment", 300) }
        : {}),
    },
  };
  validate(Content, content);
  validateContent(content);
  return content;
}

export function createNotifier(options: {
  client: SupabaseClient;
  conversationId: string;
  senderName: string;
  managerName: string;
  appendEntry: ExecutionSessions["appendEntry"];
}): (detail: Detail) => Promise<MailDelivery> {
  let identity: string | undefined;
  let cached: MailDelivery | undefined;
  let running: Promise<MailDelivery> | undefined;
  async function attempt(detail: Detail): Promise<MailDelivery> {
    const target = {
      project: detail.assignment.project,
      assignment_id: detail.assignment.id,
      claimed_at: detail.assignment.claimed_at,
      conversation_id: options.conversationId,
    };
    let stored: MessageReference | undefined, delivery: MailDelivery;
    try {
      const content = buildManagerContent(detail);
      options.appendEntry("assignment-mail", { ...target, state: "pending" });
      stored = await sendProgrammaticMail(options.client, {
        senderRole: options.senderName,
        recipientRole: options.managerName,
        conversationId: options.conversationId,
        content,
      });
      delivery = { state: "sent", reference: stored };
    } catch (error) {
      delivery = {
        state: error instanceof UncertainWriteError ? "uncertain" : "failed",
        explanation:
          error instanceof Error ? brief(error.message, 200) : "Manager report could not be sent",
      };
    }
    try {
      options.appendEntry("assignment-mail", { ...target, ...delivery });
    } catch {
      delivery = {
        state: stored || delivery.state === "uncertain" ? "uncertain" : "failed",
        explanation: stored
          ? `Server stored report ${stored.conversation_id}/${stored.id}, but local receipt could not be recorded. Do not resend.`
          : "Could not record Manager notification failure locally; inspect before retrying",
      };
    }
    return delivery;
  }
  return (detail) => {
    const key = JSON.stringify([
      detail.assignment.project,
      detail.assignment.id,
      detail.assignment.claimed_at,
    ]);
    if (identity !== undefined && identity !== key)
      return Promise.resolve({
        state: "failed",
        explanation: "Notifier belongs to a different assignment conversation",
      });
    if (cached) return Promise.resolve(cached);
    if (running) return running;
    identity = key;
    running = attempt(detail).then((delivery) => {
      cached = delivery;
      return delivery;
    });
    return running;
  };
}
