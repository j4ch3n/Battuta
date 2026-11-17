import { expect, test } from "vitest";
import { selectRecallQueries } from "../recall-context.ts";

const user = (id: string, text: string) => ({
  id,
  type: "message",
  message: { role: "user", content: [{ type: "text", text }] },
});
const assistant = (id: string, text: string) => ({
  id,
  type: "message",
  message: {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private" },
      { type: "text", text },
      { type: "toolCall", name: "bash", arguments: {} },
    ],
  },
});

test("uses the last three owner messages newest first, excluding assistant, tool and thinking content", () => {
  const entries = [
    user("u1", "first"),
    assistant("a1", "assistant reply"),
    user("u2", "second"),
    assistant("a2", "another reply"),
    user("u3", "third"),
    { id: "tool", type: "message", message: { role: "toolResult", content: "secret tool output" } },
  ];
  expect(selectRecallQueries(entries, "fourth")).toEqual(["fourth", "third", "second"]);
});

test("does not duplicate the current message when the session already contains it", () => {
  expect(selectRecallQueries([user("u1", "older"), user("u2", "latest")], "latest")).toEqual([
    "latest",
    "older",
  ]);
});

test("falls back to a neutral query when there is no owner text", () => {
  expect(selectRecallQueries([assistant("a1", "reply")], "")).toEqual(["recent owner context"]);
});
