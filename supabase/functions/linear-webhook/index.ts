import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { LinearClient } from "@linear/sdk";
import type { EntityWebhookPayloadWithIssueData } from "@linear/sdk/webhooks";

const signaturePattern = /^[0-9a-f]{64}$/i;
const replayWindowMs = 60_000;

function verifySignature(
  headerSignature: string | null,
  rawBody: Uint8Array,
  secret: string,
) {
  if (!headerSignature || !signaturePattern.test(headerSignature)) {
    return false;
  }

  const suppliedSignature = Buffer.from(headerSignature, "hex");
  const computedSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest();

  return timingSafeEqual(computedSignature, suppliedSignature);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIssueWebhookPayload(
  payload: Record<string, unknown>,
): payload is EntityWebhookPayloadWithIssueData {
  if (payload.type !== "Issue" || !isRecord(payload.data)) {
    return false;
  }

  const { data } = payload;
  return (
    typeof data.id === "string" &&
    typeof data.teamId === "string" &&
    isRecord(data.state) &&
    typeof data.state.name === "string" &&
    typeof data.state.type === "string"
  );
}

function isBacklogIssue(payload: EntityWebhookPayloadWithIssueData) {
  return payload.action !== "remove" && payload.data.state.type === "backlog";
}

async function moveIssueToTodo(issueId: string, teamId: string) {
  const apiKey = Deno.env.get("LINEAR_API_KEY");
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is not configured");
  }

  const client = new LinearClient({ apiKey });
  const [issue, team] = await Promise.all([
    client.issue(issueId),
    client.team(teamId),
  ]);

  if (!issue || !team) {
    throw new Error("Linear issue or team was not found");
  }

  const states = await team.states();
  const todoState = states.nodes.find((state) => state.name === "Todo");
  if (!todoState) {
    throw new Error(`Todo state was not found for team ${teamId}`);
  }

  const result = await issue.update({ stateId: todoState.id });
  if (!result.success) {
    throw new Error(`Could not move issue ${issueId} to Todo`);
  }
}

async function handleIssueWebhook(payload: EntityWebhookPayloadWithIssueData) {
  if (!isBacklogIssue(payload)) {
    return;
  }

  console.info("New task in Backlog", { issueId: payload.data.id });
  await moveIssueToTodo(payload.data.id, payload.data.teamId);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("LINEAR_WEBHOOK_SECRET");
  if (!secret) {
    console.error("LINEAR_WEBHOOK_SECRET is not configured");
    return new Response("Server configuration error", { status: 500 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (
    !verifySignature(request.headers.get("linear-signature"), rawBody, secret)
  ) {
    return new Response("Invalid webhook signature", { status: 401 });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  if (!isRecord(parsedPayload)) {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const payload = parsedPayload as Record<string, unknown>;

  const webhookTimestamp = payload.webhookTimestamp;
  if (
    typeof webhookTimestamp !== "number" ||
    !Number.isFinite(webhookTimestamp) ||
    Math.abs(Date.now() - webhookTimestamp) > replayWindowMs
  ) {
    return new Response("Expired webhook", { status: 401 });
  }

  if (!isIssueWebhookPayload(payload)) {
    return new Response(null, { status: 200 });
  }

  try {
    await handleIssueWebhook(payload);
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Could not handle Linear issue webhook", error);
    return new Response("Could not handle Linear issue webhook", {
      status: 500,
    });
  }
});
