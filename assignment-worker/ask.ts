import type { MessageContent } from "@battuta/agent-mail/content";
import type { MessageReference } from "@battuta/agent-mail/schemas";
import { fill } from "./contracts.ts";
import type { LifecycleMessage } from "./types.ts";

export type AskSend = (input: {
  content: MessageContent;
  messageType: "chat" | "chase";
  replyExpectation: { window: "long" } | null;
}) => Promise<MessageReference>;

export interface Ask {
  ask(input: {
    project: string;
    assignmentId: string;
    objective: string;
    body?: string;
    requirements: string[];
  }): Promise<MessageReference>;
  /** Any Manager mail ends the wait. */
  answered(): void;
  /** Claim loss or unbinding drops the question. */
  cancel(): void;
  readonly waiting: boolean;
}

/**
 * A worker question to the Manager. The code sets `requirements`, so the model cannot forget to ask for an
 * answer; an in-memory countdown chases the Manager every `chaseAfterMs` until any Manager mail arrives.
 */
export function createAsk(options: {
  send: AskSend;
  chaseAfterMs: number;
  chase: LifecycleMessage;
  worker: string;
  diagnostics: (event: string, error?: unknown) => void;
}): Ask {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { project: string; assignmentId: string; question: MessageReference } | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const schedule = () => {
    timer = setTimeout(() => {
      const current = pending;
      if (!current) return;
      const { objective, body } = fill(options.chase, {
        assignment_id: current.assignmentId,
        worker: options.worker,
      });
      options
        .send({
          content: {
            project: current.project,
            objective,
            body,
            related_messages: [current.question],
          },
          messageType: "chase",
          replyExpectation: null,
        })
        .catch((error: unknown) => options.diagnostics("Chase to the Manager failed", error));
      if (pending === current) schedule();
    }, options.chaseAfterMs);
  };
  return {
    async ask({ project, assignmentId, objective, body, requirements }) {
      const question = await options.send({
        content: { project, objective, ...(body ? { body } : {}), requirements },
        messageType: "chat",
        replyExpectation: { window: "long" },
      });
      clear();
      pending = { project, assignmentId, question };
      schedule();
      return question;
    },
    answered: clear,
    cancel: clear,
    get waiting() {
      return pending !== undefined;
    },
  };
}
