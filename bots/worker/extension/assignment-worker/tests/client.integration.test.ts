import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createAssignmentClient, AssignmentRefusalError } from "../client.ts";

test("real MCP client authenticates, reads the board, and retains scoped claim refusals", async () => {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(supabaseUrl).hostname);
  const client = await createAssignmentClient({
    supabaseUrl,
    secretKey: process.env.SUPABASE_SECRET_KEY || "",
  });
  const project = `worker-client-test-${randomUUID()}`;
  try {
    expect(await client.list({ project, status: "active" })).toEqual({ ok: true, assignments: [] });
    const error = await client
      .claim({ project, assignment_id: "12345678" })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AssignmentRefusalError);
    expect((error as AssignmentRefusalError).refusal.code).toBe("not_found");
  } finally {
    await client.close();
  }
});
