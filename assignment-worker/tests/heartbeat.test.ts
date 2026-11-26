import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssignmentRefusalError } from "../client.ts";
import { createHeartbeat } from "../heartbeat.ts";
import { detail } from "./fixtures.ts";

const claim = {
  project: "atlas",
  assignment_id: "1234abcd",
  claimed_at: "2026-11-04T12:00:00.000001Z",
  claimed_by: "test-worker",
};
const refusal = () =>
  new AssignmentRefusalError({
    ok: false,
    code: "stale_claim",
    message: "Claim replaced",
    assignment: detail().assignment,
  });

function harness(renew: () => Promise<unknown>) {
  const onLost = vi.fn();
  const diagnostics = vi.fn();
  const renewSpy = vi.fn(renew);
  const heartbeat = createHeartbeat({ renew: renewSpy, intervalMs: 60_000, onLost, diagnostics });
  return { heartbeat, renew: renewSpy, onLost, diagnostics };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("renews once per interval while started, not before the first interval", async () => {
  const h = harness(() => Promise.resolve());
  h.heartbeat.start(claim);
  expect(h.renew).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(h.renew).toHaveBeenCalledTimes(3);
  expect(h.renew).toHaveBeenCalledWith(claim);
});

test("a refused renewal reports the lost lease once and stops ticking", async () => {
  const h = harness(() => Promise.reject(refusal()));
  h.heartbeat.start(claim);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(h.renew).toHaveBeenCalledTimes(1);
  expect(h.onLost).toHaveBeenCalledTimes(1);
  expect(h.onLost.mock.calls[0][0]).toMatch(/Claim replaced/);
});

test("a failed call is retried on the next tick", async () => {
  let calls = 0;
  const h = harness(() =>
    calls++ === 0 ? Promise.reject(new Error("offline")) : Promise.resolve(),
  );
  h.heartbeat.start(claim);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(h.renew).toHaveBeenCalledTimes(2);
  expect(h.diagnostics).toHaveBeenCalledTimes(1);
  expect(h.onLost).not.toHaveBeenCalled();
});

test("stop ends all ticks", async () => {
  const h = harness(() => Promise.resolve());
  h.heartbeat.start(claim);
  await vi.advanceTimersByTimeAsync(60_000);
  h.heartbeat.stop();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(h.renew).toHaveBeenCalledTimes(1);
});

test("a refusal that resolves after stop is ignored", async () => {
  let reject: (error: unknown) => void = () => {};
  const h = harness(() => new Promise((_, fail) => (reject = fail)));
  h.heartbeat.start(claim);
  await vi.advanceTimersByTimeAsync(60_000);
  h.heartbeat.stop();
  reject(refusal());
  await vi.advanceTimersByTimeAsync(0);
  expect(h.onLost).not.toHaveBeenCalled();
});

test("a slow renewal never overlaps the next tick", async () => {
  let resolve: () => void = () => {};
  const h = harness(() => new Promise<void>((done) => (resolve = done)));
  h.heartbeat.start(claim);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(h.renew).toHaveBeenCalledTimes(1);
  resolve();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.renew).toHaveBeenCalledTimes(2);
});
