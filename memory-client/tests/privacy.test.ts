import { expect, test } from "vitest";
import { redact } from "../privacy.ts";
import { collectMessages } from "../session-messages.ts";

test.each([
  "SUPABASE_SECRET_KEY=sb_secret_" + "s".repeat(32),
  "PM_TELEGRAM_TOKEN=123456789:" + "A".repeat(35),
  "export TL_TELEGRAM_TOKEN='987654321:" + "B".repeat(35) + "'",
  "sb_secret_" + "s".repeat(32),
  "123456789:" + "A".repeat(35),
])("redacts supported credentials before conversation text can be queued", (input) => {
  const text = redact(input);
  expect(text).not.toBe(input);
  expect(text).not.toContain("s".repeat(32));
  expect(text).not.toContain("A".repeat(35));
  expect(text).not.toContain("B".repeat(35));
  expect(
    collectMessages([{ type: "message", id: "e", message: { role: "user", content: input } }])[0]
      .text,
  ).toBe(text);
});
