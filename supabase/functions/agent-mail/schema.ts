import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { Format } from "typebox/format";

Format.Set("uuid", Format.IsUuid);

const role = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" });
const uuid = Type.String({ format: "uuid" });
const id = Type.String({ pattern: "^[a-f0-9]{12}$" });
// The sender's Pi adapter owns its business schema. Transport accepts JSON objects.
const content = Type.Record(Type.String(), Type.Unknown());
const fields = {
  sender_role: role,
  message_type: Type.Union([Type.Literal("chat"), Type.Literal("chase")]),
  content,
  response_due_minutes: Type.Union([
    Type.Null(),
    Type.Literal(5),
    Type.Literal(10),
    Type.Literal(20),
  ]),
};

export const RequestSchema = Type.Union([
  Type.Object(
    {
      operation: Type.Literal("send"),
      ...fields,
      recipient_role: role,
      conversation_id: uuid,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("reply"),
      ...fields,
      parent: Type.Object({ conversation_id: uuid, id }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("read"),
      recipient_role: role,
      message_ref: Type.Object({ conversation_id: uuid, id }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
]);

export function parseRequest(input: unknown): Static<typeof RequestSchema> {
  if (!Value.Check(RequestSchema, input)) throw new Error("Invalid agent-mail request");
  const parsed = Value.Parse(RequestSchema, input);
  if (!Value.Check(RequestSchema, parsed)) throw new Error("Invalid parsed agent-mail request");
  return parsed;
}

export function rpcRequest(input: Static<typeof RequestSchema>) {
  if (input.operation === "read")
    return {
      name: "agent_mail_read",
      args: {
        p_recipient_role: input.recipient_role,
        p_conversation_id: input.message_ref.conversation_id,
        p_message_id: input.message_ref.id,
      },
    };
  const args = {
    p_sender_role: input.sender_role,
    p_message_type: input.message_type,
    p_content: input.content,
    p_response_due_minutes: input.response_due_minutes,
  };
  return input.operation === "send"
    ? {
        name: "agent_mail_send",
        args: {
          ...args,
          p_recipient_role: input.recipient_role,
          p_conversation_id: input.conversation_id,
        },
      }
    : {
        name: "agent_mail_reply",
        args: {
          ...args,
          p_parent_conversation_id: input.parent.conversation_id,
          p_parent_id: input.parent.id,
        },
      };
}
