import type { SupabaseClient } from "@supabase/supabase-js";
import { Content, validate, type MessageReference } from "../../../../agent-mail/schemas.ts";
import {
  validateContent,
  MAX_CONTENT_BYTES,
  type MessageContent,
} from "../../../../agent-mail/content.ts";
import { sendProgrammaticMail, UncertainWriteError } from "../../../../agent-mail/transport.ts";
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
  const assignmentRef = {
    locator: `assignment:${a.id}`,
    note: "Use assignment MCP to read every ordered TODO outcome and full evidence with the exact project name.",
  };
  const references = [assignmentRef];
  const seen = new Set<string>();
  for (const todo of todos)
    for (const locator of todo.evidence) {
      if (
        references.length >= 10 ||
        seen.has(locator) ||
        locator.length > 2000 ||
        Buffer.byteLength(JSON.stringify(locator)) > 2048
      )
        continue;
      seen.add(locator);
      references.push({
        locator,
        note: `Evidence reported for TODO ${todo.position}; not independent Manager verification.`,
      });
    }
  const content: MessageContent = {
    schema_version: 1,
    summary: brief(`Assignment ${a.id} ${blocked ? "blocked" : "completed"}: ${a.goal}`, 800),
    context: [
      brief(`Project: ${a.project}; assignment_id: ${a.id}`, 600),
      `Claim version: ${a.claimed_at ?? "not recorded"}. TODO positions: ${brief(todos.map((todo) => String(todo.position)).join(", "), 300)}`,
      "Recorded worker outcomes are not Manager verification or owner acceptance. Full summaries/evidence, including omitted detail, remain in the authoritative assignment.",
    ],
    findings: [],
    options: [],
    recommendation: null,
    request: null,
    result: {
      state: blocked ? "blocked" : "complete",
      accomplished: done.length
        ? done.slice(0, 10).map((todo) => brief(`TODO ${todo.position}: ${todo.outcome}`))
        : blocked
          ? []
          : [
              "Recorded assignment closed with every TODO cancelled; no completed implementation is claimed.",
            ],
      remaining: blocked
        ? [
            brief(`Blocker: ${a.blocker ?? "Inspect the authoritative assignment"}`),
            ...unfinished
              .slice(0, 8)
              .map((todo) => brief(`TODO ${todo.position} (${todo.status}): ${todo.description}`)),
          ]
        : [],
      checks: blocked
        ? []
        : [
            {
              expectation: "Recorded assignment is done and every TODO is done or cancelled.",
              required: true,
              result: "passed",
              explanation:
                "Checked the authoritative assignment status and every returned TODO status; this does not independently verify implementation or product acceptance.",
              evidence: [assignmentRef],
            },
          ],
    },
    uncertainties: [
      {
        description:
          "Outcomes and evidence are worker-reported; no independent verification is implied.",
        impact:
          "Manager must assess the commission and evidence before reporting verified delivery or acceptance.",
      },
    ],
    references,
    related_messages: [],
  };
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) {
    content.result!.accomplished = done.length
      ? [`${done.length} TODOs recorded done; read full outcomes in the assignment.`]
      : [];
    content.result!.remaining = blocked
      ? [brief(`Blocker: ${a.blocker ?? "Inspect assignment"}`, 100)]
      : [];
    content.references = [assignmentRef];
    content.context.push(
      "Mail size limits require a summary; detailed evidence was omitted, not independently reverified.",
    );
  }
  validate(Content, content);
  validateContent(content);
  return content;
}

export function createNotifier(options: {
  client: SupabaseClient;
  conversationId: string;
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
        senderRole: "worker",
        recipientRole: "manager",
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
