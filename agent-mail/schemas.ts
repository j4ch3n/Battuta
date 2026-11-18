import { Type, type Static, type TSchema } from "typebox";
import { Format } from "typebox/format";
import { Value } from "typebox/value";
import {
  MessageContentSchema,
  MessageReferenceSchema,
  validateContent,
  validateExpectation,
} from "./content.ts";
export { validateCoverage, type MessageContent } from "./content.ts";

// Make format validation explicit even if another extension changes the registry.
Format.Set("uuid", Format.IsUuid);
Format.Set("date-time", Format.IsDateTime);

// Mailbox names: cos, manager, or the worker bot name (worker-1 to worker-6).
export const BotName = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" });
const Delivery = Type.Union([Type.Literal("queue"), Type.Literal("steer")]);
export const MessageRef = MessageReferenceSchema;
export type MessageReference = Static<typeof MessageRef>;

export const Content = MessageContentSchema;
const MessageType = Type.Union([Type.Literal("chat"), Type.Literal("chase")]);
const ReplyExpectation = Type.Union([
  Type.Null(),
  Type.Object(
    { window: Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")]) },
    { additionalProperties: false },
  ),
]);
const intent = { message_type: MessageType, content: Content, reply_expectation: ReplyExpectation };

export const SendArguments = Type.Object(
  {
    recipient: BotName,
    delivery: Type.Optional(Delivery),
    assignment_id: Type.Optional(Type.String()),
    ...intent,
  },
  { additionalProperties: false },
);
export const ReplyArguments = Type.Object(
  { parent: MessageRef, ...intent },
  { additionalProperties: false },
);

export const mailTools = [
  {
    name: "send_agent_message",
    description:
      "Send a structured JSON message to another bot by bot name. Workers can send only to manager. Mail to a worker is only a follow-up on an assignment: pass assignment_id and the worker's name from that assignment's claimed_by; give new work by creating an assignment instead. All bots use the same content schema: include every field, [] for unused lists and null for unused sections. A request requires a reply expectation. Link later results to the original request with related_messages. Use chat for ordinary mail; chase for an intentional follow-up. delivery queue (default) is handled after the recipient's current work; steer interrupts it between tool calls, so reserve it for urgent corrections. Choose short for acknowledgement, medium for bounded investigation, long for deeper review.",
    parameters: SendArguments,
  },
  {
    name: "reply_agent_message",
    description:
      "Answer incoming mail using the shared structured content schema. Copy message_ref into parent, not in_reply_to. Include every content field; use [] or null for unused sections. State a conclusion, clarification, or honest progress. For a complete result, copy request requirements exactly into evidence-backed required checks. A new request requires a reply expectation; otherwise use null.",
    parameters: ReplyArguments,
  },
];

export function validate<T extends TSchema>(schema: T, input: unknown): Static<T> {
  // Check before Parse: never coerce or clean malformed LLM arguments into a send.
  if (!Value.Check(schema, input))
    throw new Error(
      `Invalid agent-mail value: ${JSON.stringify([...Value.Errors(schema, input)])}`,
    );
  const parsed = Value.Parse(schema, input);
  if (!Value.Check(schema, parsed)) throw new Error("Invalid parsed agent-mail value");
  return parsed;
}

type AgentContext = { role: Static<typeof BotName>; sessionId: string };
export function sendRequest(agent: AgentContext, input: unknown) {
  const args = validate(SendArguments, input);
  validateExpectation(args.content, args.reply_expectation !== null);
  if (args.recipient === agent.role) throw new Error("Cannot send agent mail to yourself");
  return {
    operation: "send" as const,
    sender_role: agent.role,
    recipient_role: args.recipient,
    conversation_id: agent.sessionId,
    message_type: args.message_type,
    content: args.content,
    response_due_minutes: offset(args.reply_expectation),
    ...(args.delivery ? { delivery: args.delivery } : {}),
  };
}
export function replyRequest(agent: AgentContext, input: unknown) {
  const args = validate(ReplyArguments, input);
  validateExpectation(args.content, args.reply_expectation !== null);
  return {
    operation: "reply" as const,
    sender_role: agent.role,
    parent: args.parent,
    message_type: args.message_type,
    content: args.content,
    response_due_minutes: offset(args.reply_expectation),
  };
}
function offset(expectation: Static<typeof ReplyExpectation>) {
  return expectation === null ? null : { short: 5, medium: 10, long: 20 }[expectation.window];
}

export const StoredMessage = Type.Object(
  {
    ...MessageRef.properties,
    sender: Type.String(),
    recipient: Type.String(),
    message_type: MessageType,
    content: Content,
    delivery: Delivery,
    status: Type.Union([Type.Literal("created"), Type.Literal("read"), Type.Literal("replied")]),
    in_reply_to: Type.Union([Type.Null(), MessageRef.properties.id]),
    response_due: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
    created_at: Type.String({ format: "date-time" }),
    read_at: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
    replied_at: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  },
  { additionalProperties: false },
);
export type Message = Static<typeof StoredMessage>;
export const reference = (message: Message): MessageReference => ({
  conversation_id: message.conversation_id,
  id: message.id,
});
export const referenceKey = (ref: MessageReference) => `${ref.conversation_id}:${ref.id}`;
export function envelope(message: Message) {
  validateContent(message.content);
  return {
    message_ref: reference(message),
    in_reply_to:
      message.in_reply_to === null
        ? null
        : { conversation_id: message.conversation_id, id: message.in_reply_to },
    sender: message.sender,
    recipient: message.recipient,
    message_type: message.message_type,
    content: message.content,
    created_at: message.created_at,
    response_due: message.response_due,
  };
}
