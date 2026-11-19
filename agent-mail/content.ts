// One content contract for both roles. Supabase stores JSON without knowing it.
import { Type, type Static, type TProperties, type TSchema } from "typebox";

const text = (description: string, maxLength = 4000) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S", description });
const object = <P extends TProperties>(properties: P, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const array = <T extends TSchema>(item: T, description: string, maxItems = 30) =>
  Type.Array(item, { maxItems, description });

const messageReference = object({
  conversation_id: Type.String({ format: "uuid" }),
  id: Type.String({ pattern: "^[a-f0-9]{12}$" }),
});
const optional = <T extends TSchema>(item: T) => Type.Optional(item);
const content = object(
  {
    project: text("Project name this message is about.", 200),
    ticket: optional(text("Ticket identifier, when one exists.", 100)),
    objective: text(
      "The ask, or the outcome being reported, in one or two sentences. Lead with it.",
      2000,
    ),
    body: optional(
      text("Supporting evidence, background, risks, or recommendation. Omit when not needed."),
    ),
    requirements: optional(
      array(
        text("Observable requirement the recipient must satisfy."),
        "Present when this message asks for action or an answer; it needs a reply expectation. Numbered from 1 by position.",
      ),
    ),
    result: optional(
      object(
        {
          state: Type.Union(
            [Type.Literal("in_progress"), Type.Literal("blocked"), Type.Literal("complete")],
            {
              description:
                "State of the requested action, not automatically product acceptance or release.",
            },
          ),
          checks: array(
            object({
              req: Type.Integer({
                minimum: 1,
                description: "Position (from 1) of the request requirement this check covers.",
              }),
              result: Type.Union(
                [Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_verified")],
                { description: "Actual verification result." },
              ),
              evidence: optional(
                text(
                  "Real evidence: URL, repository path, commit hash, or record. Required to pass.",
                ),
              ),
            }),
            "Coverage of the original request's requirements.",
          ),
          blocker: optional(text("What blocks the work. Required when blocked.")),
        },
        "Present when this message reports an outcome.",
      ),
    ),
    related_messages: optional(
      array(
        messageReference,
        "Earlier exchanges this builds on. Include the original request when reporting its result; this does not replace the reply parent.",
        10,
      ),
    ),
  },
  "One shared content contract for every bot. Omit unused optional fields.",
);

export const MessageContentSchema = content;
export type MessageContent = Static<typeof content>;
export const MessageReferenceSchema = messageReference;
export type MessageReference = Static<typeof messageReference>;
export const MAX_CONTENT_BYTES = 65536;

// Structural checking is performed by TypeBox before these rules.
export function validateContent(content: MessageContent) {
  if (new TextEncoder().encode(JSON.stringify(content)).length > MAX_CONTENT_BYTES) {
    throw new Error("content exceeds 65536 bytes; summarize and reference longer evidence");
  }
  const result = content.result;
  if (!result) return;
  if (result.state === "blocked" && !result.blocker) {
    throw new Error("result.state blocked requires result.blocker");
  }
  if (result.state !== "complete") return;
  if (result.checks.some((check) => check.result !== "passed" || !check.evidence)) {
    throw new Error(
      "result.state complete requires every check passed with evidence; otherwise report in_progress or blocked",
    );
  }
}

export function validateExpectation(content: MessageContent, expectsReply: boolean) {
  validateContent(content);
  if (content.requirements && !expectsReply)
    throw new Error("content.requirements requires a non-null reply_expectation");
}

export function validateCoverage(content: MessageContent, requests: MessageContent[]) {
  if (content.result?.state !== "complete") return;
  for (const request of requests) {
    (request.requirements ?? []).forEach((requirement, index) => {
      if (
        !content.result!.checks.some(
          (check) => check.req === index + 1 && check.result === "passed" && check.evidence,
        )
      ) {
        throw new Error(
          `result.checks must cover request requirement ${index + 1} with a passed, evidenced check: ${requirement}`,
        );
      }
    });
  }
}
