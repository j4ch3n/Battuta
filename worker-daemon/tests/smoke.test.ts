import { expect, it } from "vitest";
import { smokeSettings } from "../scripts/smoke.ts";

const env = {
  BATTUTA_SMOKE_APPROVAL: "test-only-model-spend",
  BATTUTA_SMOKE_BUDGET_USD: "0.50",
  BATTUTA_SMOKE_PROJECT: "isolated-smoke",
  BATTUTA_SMOKE_CONFIG: "/private/smoke.json",
  BATTUTA_SMOKE_MAIL_SECRET_KEY: "test-admin",
  BATTUTA_SMOKE_DELEGATOR_EMAIL: "pm@test.local",
  BATTUTA_SMOKE_DELEGATOR_PASSWORD: "test-password",
  SUPABASE_URL: "http://test.local",
  SUPABASE_PUBLISHABLE_KEY: "public",
  WORKER_TASK_EMAIL: "worker@test.local",
  WORKER_TASK_PASSWORD: "test-password",
};
it.each(Object.keys(env))("refuses smoke before any external call without explicit %s", (key) => {
  expect(() => smokeSettings({ ...env, [key]: undefined })).toThrow();
});
it.each(["0", "-1", "NaN", "Infinity", ""])("rejects invalid approved budget %s", (budget) => {
  expect(() => smokeSettings({ ...env, BATTUTA_SMOKE_BUDGET_USD: budget })).toThrow();
});
it("accepts explicit test credentials/approval and bounds the deadline", () => {
  expect(smokeSettings(env)).toMatchObject({
    budgetUSD: 0.5,
    deadlineMs: 120000,
    project: "isolated-smoke",
  });
  expect(() => smokeSettings({ ...env, BATTUTA_SMOKE_DEADLINE_MS: "600001" })).toThrow();
  expect(() => smokeSettings({ ...env, BATTUTA_SMOKE_APPROVAL: "yes" })).toThrow();
});
