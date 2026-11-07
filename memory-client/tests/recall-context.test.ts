import { expect, test } from "vitest";
import { selectRecallInput } from "../recall-context.ts";

test("selects latest summary and ten human/assistant texts, never tool or thinking blocks", () => {
  const entries = [
    { type: "compaction", summary: "old" },
    { type: "compaction", summary: "latest summary" },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      type: "message",
      message: {
        role: i % 2 ? "assistant" : "user",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: `text ${i}` },
          { type: "toolCall", name: "bash", arguments: {} },
        ],
      },
    })),
    { id: "tool", type: "message", message: { role: "toolResult", content: "secret tool output" } },
    { id: "mail", type: "custom_message", customType: "agent-mail", content: "mail" },
    {
      id: "empty",
      type: "message",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }] },
    },
  ];
  const input = selectRecallInput(entries, "text 11");
  expect(input.summary).toBe("latest summary");
  expect(input.history.map((m) => m.text)).toEqual(
    Array.from({ length: 10 }, (_, i) => `text ${i + 2}`),
  );
  expect(input.current).toBe("text 11");
  expect(JSON.stringify(input)).not.toMatch(/private|bash|tool output|mail|hidden/);
});

test("missing summary and short retained history remain unchanged except credential redaction", () => {
  const input = selectRecallInput(
    [{ id: "e", type: "message", message: { role: "user", content: "hello" } }],
    "hello",
  );
  expect(input).toEqual({ history: [{ role: "user", text: "hello" }], current: "hello" });
});
