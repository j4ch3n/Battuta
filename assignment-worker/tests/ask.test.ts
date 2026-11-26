import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAsk, type AskSend } from "../ask.ts";

const question = { conversation_id: "11111111-1111-4111-8111-111111111111", id: "aaaaaaaaaaaa" };
const chase = { conversation_id: question.conversation_id, id: "bbbbbbbbbbbb" };

function harness(send: AskSend = vi.fn(() => Promise.resolve(question))) {
  const diagnostics = vi.fn();
  const sendSpy = vi.fn(send);
  const ask = createAsk({
    send: sendSpy,
    chaseAfterMs: 1_800_000,
    chase: { objective: "Waiting on {assignment_id}", body: "{worker} waits" },
    worker: "worker-1",
    diagnostics,
  });
  return { ask, send: sendSpy, diagnostics };
}
const input = {
  project: "atlas",
  assignmentId: "1234abcd",
  objective: "Which API should I use?",
  requirements: ["Name the API"],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("ask sends the question with requirements and a reply expectation, then waits", async () => {
  const h = harness();
  expect(await h.ask.ask(input)).toEqual(question);
  expect(h.send).toHaveBeenCalledWith({
    content: { project: "atlas", objective: input.objective, requirements: input.requirements },
    messageType: "chat",
    replyExpectation: { window: "long" },
  });
  expect(h.ask.waiting).toBe(true);
});

test("an unanswered question is chased every window, linked to the question", async () => {
  const h = harness();
  await h.ask.ask(input);
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(h.send).toHaveBeenCalledTimes(2);
  expect(h.send.mock.calls[1][0]).toEqual({
    content: {
      project: "atlas",
      objective: "Waiting on 1234abcd",
      body: "worker-1 waits",
      related_messages: [question],
    },
    messageType: "chase",
    replyExpectation: null,
  });
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(h.send).toHaveBeenCalledTimes(3);
});

test.each(["answered", "cancel"] as const)("%s before the window sends no chase", async (end) => {
  const h = harness();
  await h.ask.ask(input);
  h.ask[end]();
  expect(h.ask.waiting).toBe(false);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(h.send).toHaveBeenCalledTimes(1);
});

test("a chase that fails to send is retried on the next window", async () => {
  let calls = 0;
  const h = harness(() => {
    calls++;
    return calls === 2 ? Promise.reject(new Error("offline")) : Promise.resolve(chase);
  });
  await h.ask.ask(input);
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(h.diagnostics).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(h.send).toHaveBeenCalledTimes(3);
});

test("a question that fails to send throws and does not wait", async () => {
  const h = harness(() => Promise.reject(new Error("offline")));
  await expect(h.ask.ask(input)).rejects.toThrow("offline");
  expect(h.ask.waiting).toBe(false);
});
