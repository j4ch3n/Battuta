import { expect, test } from "vitest";
import { MAX_CONTENT_BYTES } from "@battuta/agent-mail/content";
import { Content, validate } from "@battuta/agent-mail/schemas";
import { sendProgrammaticMail, UncertainWriteError } from "@battuta/agent-mail/transport";

test("resolves the Agent Mail public contract", () => {
  expect(MAX_CONTENT_BYTES).toBeGreaterThan(0);
  expect(Content).toBeDefined();
  expect(validate).toBeTypeOf("function");
  expect(sendProgrammaticMail).toBeTypeOf("function");
  expect(UncertainWriteError).toBeTypeOf("function");
});
