import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isFreshTimestamp,
  isIssueWebhookPayload,
  isNewBacklogIssue,
  verifySignature,
} from "./webhook.ts";

Deno.test("signature authenticates exact raw bytes and rejects malformed or tampered input", () => {
  const body = new TextEncoder().encode('{"type":"Issue"}');
  const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifySignature(signature, body, "test-secret"), true);
  for (const invalid of [null, "", "ab", "g".repeat(64), "0".repeat(64)]) {
    assert.equal(verifySignature(invalid, body, "test-secret"), false);
  }
  assert.equal(verifySignature(signature, body, "wrong-secret"), false);
  assert.equal(
    verifySignature(signature, new TextEncoder().encode('{ "type":"Issue"}'), "test-secret"),
    false,
  );
});

Deno.test("replay window rejects expired, future and non-finite timestamps", () => {
  const now = 1_000_000;
  for (const timestamp of [now, now - 60_000, now + 60_000]) {
    assert.equal(isFreshTimestamp(timestamp, now), true);
  }
  for (const timestamp of [now - 60_001, now + 60_001, NaN, Infinity, "1000000", null]) {
    assert.equal(isFreshTimestamp(timestamp, now), false);
  }
});

Deno.test("only newly created backlog issues qualify for dispatch", () => {
  const payload = {
    type: "Issue",
    action: "create",
    webhookTimestamp: 1_000_000,
    data: {
      id: "issue",
      identifier: "BAT-1",
      teamId: "team",
      title: "Task",
      url: "https://linear.app/issue",
      state: { name: "Backlog", type: "backlog" },
    },
  };
  assert.ok(isIssueWebhookPayload(payload));
  assert.equal(isNewBacklogIssue(payload), true);
  const update = { ...payload, action: "update" };
  assert.ok(isIssueWebhookPayload(update));
  assert.equal(isNewBacklogIssue(update), false);
  const started = {
    ...payload,
    data: { ...payload.data, state: { name: "Todo", type: "unstarted" } },
  };
  assert.ok(isIssueWebhookPayload(started));
  assert.equal(isNewBacklogIssue(started), false);
  for (const invalid of [
    {},
    { ...payload, type: "Comment" },
    { ...payload, data: null },
    { ...payload, data: { ...payload.data, id: 1 } },
    { ...payload, data: { ...payload.data, state: [] } },
  ]) {
    assert.equal(isIssueWebhookPayload(invalid), false);
  }
});
