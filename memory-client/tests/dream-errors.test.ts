import { expect, test } from "vitest";
import { z } from "zod";
import { dreamDiagnostic } from "../dream-errors.ts";

test("known validation failures expose the violated rule, unknown errors hide private text", () => {
  expect(dreamDiagnostic(new Error("Repeated mutation target"), "cleanup")).toMatchObject({
    stage: "cleanup",
    code: "invalid_artifact",
    message: "Repeated mutation target",
  });
  expect(
    JSON.stringify(dreamDiagnostic(new Error("secret private memory text"), "cleanup")),
  ).not.toContain("secret private memory text");
});

test("schema diagnostics expose safe constraint locations without invalid values or hostile paths", () => {
  const result = z
    .object({ operations: z.array(z.object({ content: z.string() }).strict()) })
    .strict()
    .safeParse({ operations: [{ content: 42, "secret-private-key": "private" }] });
  expect(result.success).toBe(false);
  if (!result.success) {
    const diagnostic = dreamDiagnostic(result.error, "cleanup");
    expect(diagnostic.paths).toContain("operations.0.content");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-private-key");
    expect(JSON.stringify(diagnostic)).not.toContain("42");
  }
});

test.each([
  [z.string().max(80), "x".repeat(81), "80"],
  [z.string().regex(/^[a-z0-9_-]{1,40}$/), "BAD_ID", "40"],
  [z.string().datetime({ offset: true }), "yesterday", "timezone"],
] as const)("schema feedback explains the expected constraint", (schema, value, expected) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("Expected invalid fixture");
  expect(dreamDiagnostic(result.error, "cleanup").message).toContain(expected);
});
