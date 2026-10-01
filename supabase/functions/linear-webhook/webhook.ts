import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EntityWebhookPayloadWithIssueData } from "@linear/sdk/webhooks";

const signaturePattern = /^[0-9a-f]{64}$/i;
const replayWindowMs = 60_000;

export function verifySignature(
  headerSignature: string | null,
  rawBody: Uint8Array,
  secret: string,
) {
  if (!headerSignature || !signaturePattern.test(headerSignature)) return false;
  const suppliedSignature = Buffer.from(headerSignature, "hex");
  const computedSignature = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(computedSignature, suppliedSignature);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIssueWebhookPayload(
  payload: Record<string, unknown>,
): payload is EntityWebhookPayloadWithIssueData {
  if (payload.type !== "Issue" || !isRecord(payload.data)) return false;
  const { data } = payload;
  return (
    typeof data.id === "string" &&
    typeof data.identifier === "string" &&
    typeof data.teamId === "string" &&
    typeof data.title === "string" &&
    typeof data.url === "string" &&
    isRecord(data.state) &&
    typeof data.state.name === "string" &&
    typeof data.state.type === "string"
  );
}

export function isNewBacklogIssue(payload: EntityWebhookPayloadWithIssueData) {
  return payload.action === "create" && payload.data.state.type === "backlog";
}

export function isFreshTimestamp(timestamp: unknown, now = Date.now()) {
  return (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    Math.abs(now - timestamp) <= replayWindowMs
  );
}
