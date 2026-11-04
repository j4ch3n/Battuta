import { expect, test, vi } from "vitest";
import {
  AssignmentService,
  AssignmentRefusalError,
  UncertainAssignmentWriteError,
  createAssignmentClient,
} from "../client.ts";
import { detail } from "./fixtures.ts";

test("code-owned client preserves exact execution targets and timestamp strings", async () => {
  const d = detail();
  const callTool = vi.fn().mockResolvedValue({
    content: [],
    structuredContent: { ok: true, assignment: d.assignment, todo: d.todos[0] },
  });
  const client = new AssignmentService({ callTool, close: vi.fn() });
  const target = {
    project: "atlas",
    assignment_id: "1234abcd",
    claimed_at: "2026-11-04T12:00:00.123456+00:00",
    position: 1,
    expected_updated_at: "2026-11-04T12:00:01.654321+00:00",
  };
  expect((await client.start(target)).todo.updated_at).toBe(d.todos[0].updated_at);
  expect(callTool).toHaveBeenCalledWith({ name: "start_todo", arguments: target });
});
test("business refusals retain authoritative recovery metadata", async () => {
  const d = detail();
  const refusal = {
    ok: false,
    code: "not_claimable",
    message: "Inspect",
    assignment: d.assignment,
    reason: "dependencies",
  };
  const client = new AssignmentService({
    callTool: vi.fn().mockResolvedValue({ content: [], structuredContent: refusal, isError: true }),
    close: vi.fn(),
  });
  const error = await client
    .claim({ project: "atlas", assignment_id: "1234abcd" })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AssignmentRefusalError);
  expect((error as AssignmentRefusalError).refusal).toEqual(refusal);
});
test.each(["network", "malformed"])(
  "uncertain %s claim is attempted once with no inferred ownership",
  async (kind) => {
    const callTool =
      kind === "network"
        ? vi.fn().mockRejectedValue(new Error("secret sentinel"))
        : vi.fn().mockResolvedValue({ content: [], structuredContent: { ok: true } });
    const client = new AssignmentService({ callTool, close: vi.fn() });
    const error = await client
      .claim({ project: "atlas", assignment_id: "1234abcd" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UncertainAssignmentWriteError);
    expect(String(error)).not.toContain("secret sentinel");
    expect(callTool).toHaveBeenCalledTimes(1);
  },
);
test("failed reads never become successful empty work boards", async () => {
  const client = new AssignmentService({
    callTool: vi.fn().mockRejectedValue(new Error("offline")),
    close: vi.fn(),
  });
  await expect(client.list({ status: "active" })).rejects.not.toBeInstanceOf(
    UncertainAssignmentWriteError,
  );
});

test.each([
  "http://remote.invalid/",
  "https://user:private-sentinel@host.invalid/",
  "https://host.invalid/?key=private-sentinel",
  "https://host.invalid/nested",
])("rejects unsafe configuration without exposing credentials: %s", async (supabaseUrl) => {
  const error = await createAssignmentClient({ supabaseUrl, secretKey: "private-sentinel" }).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain("private-sentinel");
});

test.each([
  { ok: false, code: "backend_error", message: "Inspect" },
  { ok: false, code: "invalid_transition", message: "Missing state" },
  { ok: false, code: "stale_update", message: "Missing TODO" },
])(
  "unusable backend recovery data never authorizes another mutation: %j",
  async (structuredContent) => {
    const client = new AssignmentService({
      callTool: vi.fn().mockResolvedValue({ content: [], structuredContent, isError: true }),
      close: vi.fn(),
    });
    await expect(
      client.claim({ project: "atlas", assignment_id: "1234abcd" }),
    ).rejects.toBeInstanceOf(UncertainAssignmentWriteError);
  },
);
