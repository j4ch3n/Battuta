import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { checkSendRoute } from "../routing.ts";

const claims: Record<string, string | null> = { a1: "worker-1", free: null };
const claimant = (id: string) => Promise.resolve(claims[id] ?? null);
const route = (sender: string, recipient: string, assignmentId?: string) =>
  checkSendRoute({ sender, recipient, assignmentId, claimant });

describe("worker senders", () => {
  test("may send to manager without consulting assignments", async () => {
    await checkSendRoute({
      sender: "worker-1",
      recipient: "manager",
      claimant: () => assert.fail("claimant must not be consulted"),
    });
  });

  test.each([
    ["cos", undefined],
    ["cos", "a1"],
    ["worker-2", undefined],
    ["worker-2", "a1"],
  ])("cannot send to %s (assignment %s) and is pointed at manager", async (recipient, id) => {
    await assert.rejects(route("worker-1", recipient, id), /manager/);
  });
});

describe("coordinator senders", () => {
  test.each([
    ["manager", "cos"],
    ["cos", "manager"],
  ])("%s may send to %s", async (sender, recipient) => {
    await route(sender, recipient);
  });

  test("need an assignment to reach a worker", async () => {
    await assert.rejects(route("manager", "worker-1"), /assignment/);
  });

  test("may follow up with the worker that claimed the assignment", async () => {
    await route("manager", "worker-1", "a1");
  });

  test.each([
    ["an unknown assignment", "worker-1", "nope"],
    ["an unclaimed assignment", "worker-1", "free"],
    ["an assignment claimed by another worker", "worker-2", "a1"],
    ["a recipient differing only by case", "Worker-1", "a1"],
    ["a quoted id", "worker-1", "x' or 1=1"],
    ["a wildcard id", "worker-1", "%"],
    ["a very long id", "worker-1", "a".repeat(5000)],
  ])("reject %s", async (_name, recipient, id) => {
    await assert.rejects(route("manager", recipient, id), /assignment/);
  });

  test("a failed lookup fails the send", async () => {
    await assert.rejects(
      checkSendRoute({
        sender: "manager",
        recipient: "worker-1",
        assignmentId: "a1",
        claimant: () => Promise.reject(new Error("database unavailable")),
      }),
      /database unavailable/,
    );
  });
});
