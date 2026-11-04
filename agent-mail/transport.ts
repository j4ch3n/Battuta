import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageContent } from "./content.ts";
import { validateContent } from "./content.ts";
import {
  SenderRole,
  MessageRef,
  StoredMessage,
  sendRequest,
  reference,
  validate,
  type MessageReference,
} from "./schemas.ts";

export class UncertainWriteError extends Error {}
export class MailSendError extends Error {}

export async function invokeMail(
  client: SupabaseClient,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  let result;
  try {
    result = await client.functions.invoke("agent-mail", { body, signal });
  } catch {
    throw new UncertainWriteError("Agent mail delivery could not be confirmed");
  }
  if (result.error) {
    const response = (result.error as { context?: unknown }).context;
    if (response instanceof Response) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof payload?.error === "string") {
        throw response.status >= 500
          ? new UncertainWriteError(payload.error)
          : new MailSendError(payload.error);
      }
    }
    throw new UncertainWriteError("Agent mail delivery could not be confirmed");
  }
  const envelope = result.data as { data?: unknown; error?: unknown } | null;
  if (!envelope || envelope.error || envelope.data === undefined || envelope.data === null)
    throw new UncertainWriteError("Agent mail acknowledgement was malformed");
  return envelope.data;
}

export async function sendProgrammaticMail(
  client: SupabaseClient,
  input: {
    senderRole: "cos" | "manager" | "worker";
    recipientRole: "cos" | "manager";
    conversationId: string;
    content: MessageContent;
  },
): Promise<MessageReference> {
  let request: ReturnType<typeof sendRequest>;
  try {
    const role = validate(SenderRole, input.senderRole);
    if (role === "worker" && input.recipientRole !== "manager")
      throw new Error("Workers report only to Manager");
    const sessionId = validate(MessageRef.properties.conversation_id, input.conversationId);
    request = sendRequest(
      { role, sessionId },
      {
        recipient: input.recipientRole,
        message_type: "chat",
        content: input.content,
        reply_expectation: null,
      },
    );
  } catch (error) {
    throw new MailSendError(
      error instanceof Error ? error.message : "Invalid programmatic mail input",
    );
  }
  const response = await invokeMail(client, request);
  try {
    const message = validate(StoredMessage, response);
    validateContent(message.content);
    if (
      message.conversation_id !== request.conversation_id ||
      message.sender !== request.sender_role ||
      message.recipient !== request.recipient_role ||
      message.message_type !== "chat" ||
      message.response_due !== null ||
      !isDeepStrictEqual(message.content, request.content)
    )
      throw new Error("Mismatched stored result");
    return reference(message);
  } catch {
    throw new UncertainWriteError("Stored mail acknowledgement did not match the validated report");
  }
}
