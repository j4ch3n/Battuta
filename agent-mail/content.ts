// One content contract for both roles. Supabase stores JSON without knowing it.
import { Type, type Static, type TProperties, type TSchema } from "typebox";

const text = (description: string, maxLength = 4000) => Type.String({ minLength: 1, maxLength, pattern: "\\S", description });
const object = <P extends TProperties>(properties: P, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const array = <T extends TSchema>(item: T, description: string, maxItems = 30) => Type.Array(item, { maxItems, description });
const nullable = <T extends TSchema>(item: T) => Type.Union([item, Type.Null()]);

const reference = object({
  locator: text("Real evidence location: URL, repository path, commit hash, or identifiable decision record.", 2000),
  note: text("What this source establishes.", 1000),
});
const references = () => array(reference, "Supporting evidence. Use [] when no evidence is available.", 10);
const messageReference = object({
  conversation_id: Type.String({ format: "uuid" }),
  id: Type.String({ pattern: "^[a-f0-9]{12}$" }),
});
const content = object({
  schema_version: Type.Literal(1),
  summary: text("Lead with the main finding, request, decision, or outcome.", 2000),
  context: array(text("Background, intended behavior, scope boundaries, constraints, or authorization."), "Relevant context; no ticket or title is required."),
  findings: array(object({
    statement: text("What is known. Do not present inference as confirmation."),
    basis: Type.Union([Type.Literal("observed"), Type.Literal("confirmed"), Type.Literal("inferred")], { description: "Distinguish observations, confirmed information, and inference." }),
    evidence: references(),
  }), "Established findings and their sources."),
  options: array(object({
    description: text("A concrete alternative."),
    benefits: array(text("Benefit of this alternative."), "Benefits."),
    drawbacks: array(text("Drawback or consequence of this alternative."), "Drawbacks."),
  }), "Alternatives worth comparing. Use [] when comparison is unnecessary.", 5),
  recommendation: nullable(text("Preferred next step and rationale; null when no recommendation is needed.")),
  request: nullable(object({
    action: text("Specific action or focused question for the recipient."),
    requirements: array(text("Observable requirement. Preserve this wording in result.checks.expectation."), "Requirements the action must satisfy. These are not permission to expand scope."),
    expected_response: text("What the recipient should report back."),
  }, "Use null when no action or answer is requested. A request requires a reply expectation.")),
  result: nullable(object({
    state: Type.Union([Type.Literal("in_progress"), Type.Literal("blocked"), Type.Literal("complete")], { description: "State of the requested action, not automatically product acceptance or release." }),
    accomplished: array(text("Work or investigation actually accomplished."), "Verified accomplishments."),
    remaining: array(text("Remaining work or blocker."), "Remaining work. Must be empty for complete."),
    checks: array(object({
      expectation: text("Expectation checked. Copy the original request requirement exactly when reporting its coverage."),
      required: Type.Boolean({ description: "Whether this check is required for completion." }),
      result: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_verified")], { description: "Actual verification result." }),
      explanation: text("What was checked and any limits of the verification."),
      evidence: references(),
    }), "Requirement coverage, tests, and review evidence."),
  }, "Use null when this message is not reporting an outcome.")),
  uncertainties: array(object({
    description: text("Assumption, unanswered question, risk, or blocker."),
    impact: text("How this uncertainty affects the work or decision."),
  }), "Unresolved information and its impact."),
  references: references(),
  related_messages: array(messageReference, "Earlier exchanges this builds on. Include the original request when reporting its result; this does not replace the reply parent.", 10),
}, "One shared content contract for PM and tech lead. Include every field; use [] or null for unused sections.");

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
  if (result.state === "blocked" && !result.remaining.length && !content.uncertainties.length) {
    throw new Error("result.state blocked requires a blocker in remaining or uncertainties");
  }
  if (result.state !== "complete") return;
  if (!result.accomplished.length || result.remaining.length) {
    throw new Error("result.state complete requires accomplishments and no remaining work");
  }
  const required = result.checks.filter((check) => check.required);
  if (!required.length || required.some((check) => check.result !== "passed" || !check.evidence.length)) {
    throw new Error("result.state complete requires passing, evidence-backed required checks; otherwise report in_progress or blocked");
  }
}

export function validateExpectation(content: MessageContent, expectsReply: boolean) {
  validateContent(content);
  if (content.request !== null && !expectsReply) throw new Error("content.request requires a non-null reply_expectation");
}

export function validateCoverage(content: MessageContent, requests: MessageContent[]) {
  if (content.result?.state !== "complete") return;
  for (const request of requests) {
    for (const requirement of request.request?.requirements ?? []) {
      if (!content.result.checks.some((check) => check.expectation === requirement && check.required && check.result === "passed" && check.evidence.length)) {
        throw new Error(`result.checks must cover the request requirement exactly: ${requirement}`);
      }
    }
  }
}
