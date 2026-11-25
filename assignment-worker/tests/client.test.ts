import { expect, test, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import {
  AssignmentService,
  AssignmentRefusalError,
  UncertainAssignmentWriteError,
  createAssignmentClient,
} from "../client.ts";
import { detail, settings } from "./fixtures.ts";

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
    claimed_by: "test-worker",
    position: 1,
    expected_updated_at: "2026-11-04T12:00:01.654321+00:00",
  };
  expect((await client.start(target)).todo.updated_at).toBe(d.todos[0].updated_at);
  expect(callTool).toHaveBeenCalledWith({ name: "start_todo", arguments: target });
});

test("local session bindings never leak into strict remote MCP arguments", async () => {
  const d = detail();
  const callTool = vi
    .fn<Client["callTool"]>()
    .mockResolvedValue({ content: [], structuredContent: d });
  const client = new AssignmentService({ callTool, close: vi.fn() });
  const binding = {
    project: "atlas",
    assignment_id: "1234abcd",
    claimed_at: "2026-11-04T12:00:00.123456+00:00",
    claimed_by: "test-worker",
    session_file: "private-session",
  };
  await client.get(binding);
  expect(callTool).toHaveBeenLastCalledWith({
    name: "get_assignment",
    arguments: { project: "atlas", assignment_id: "1234abcd" },
  });
  callTool.mockResolvedValue({
    content: [],
    structuredContent: { ok: true, assignment: d.assignment, todo: d.todos[0] },
  });
  const target = { ...binding, position: 1, expected_updated_at: d.todos[0].updated_at };
  await client.start(target);
  expect(callTool.mock.calls[1][0].arguments).not.toHaveProperty("session_file");
  await client.record({ ...target, outcome: "completed", summary: "Done", evidence: [] });
  expect(callTool.mock.calls[2][0].arguments).not.toHaveProperty("session_file");
  callTool.mockResolvedValue({
    content: [],
    structuredContent: { ok: true, assignment: d.assignment },
  });
  await client.block({ ...binding, blocker: "Missing input" });
  await client.finish(binding);
  for (const [call] of callTool.mock.calls)
    expect(call.arguments).not.toHaveProperty("session_file");
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
    .claim({
      project: "atlas",
      assignment_id: "1234abcd",
      claimed_by: "test-worker",
      abilities: [],
      conversation_id: "11111111-1111-4111-8111-111111111111",
    })
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
      .claim({
        project: "atlas",
        assignment_id: "1234abcd",
        claimed_by: "test-worker",
        abilities: [],
        conversation_id: "11111111-1111-4111-8111-111111111111",
      })
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
      client.claim({
        project: "atlas",
        assignment_id: "1234abcd",
        claimed_by: "test-worker",
        abilities: [],
        conversation_id: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(UncertainAssignmentWriteError);
  },
);

const claim = {
  project: "atlas",
  assignment_id: "1234abcd",
  claimed_at: "2026-11-04T12:00:00.123456+00:00",
  claimed_by: "test-worker",
};
test("renew sends the claim and maps refusals and lost acknowledgements", async () => {
  const d = detail();
  const callTool = vi
    .fn<Client["callTool"]>()
    .mockResolvedValueOnce({
      content: [],
      structuredContent: { ok: true, assignment: d.assignment },
    })
    .mockResolvedValueOnce({
      content: [],
      isError: true,
      structuredContent: {
        ok: false,
        code: "stale_claim",
        message: "Gone",
        assignment: d.assignment,
      },
    })
    .mockRejectedValueOnce(new Error("offline"));
  const client = new AssignmentService({ callTool, close: vi.fn() });
  await client.renew({ ...claim, session_file: "private" } as typeof claim);
  expect(callTool).toHaveBeenLastCalledWith({ name: "renew_assignment", arguments: claim });
  await expect(client.renew(claim)).rejects.toBeInstanceOf(AssignmentRefusalError);
  await expect(client.renew(claim)).rejects.toBeInstanceOf(UncertainAssignmentWriteError);
});
test("claim sends the conversation the expiry notice will use", async () => {
  const callTool = vi
    .fn<Client["callTool"]>()
    .mockResolvedValue({ content: [], structuredContent: detail() });
  const client = new AssignmentService({ callTool, close: vi.fn() });
  const input = {
    project: "atlas",
    assignment_id: "1234abcd",
    claimed_by: "test-worker",
    abilities: ["research"],
    conversation_id: "11111111-1111-4111-8111-111111111111",
  };
  await client.claim(input);
  expect(callTool).toHaveBeenCalledWith({ name: "claim_assignment", arguments: input });
});
test("settings are read and validated", async () => {
  const callTool = vi
    .fn<Client["callTool"]>()
    .mockResolvedValueOnce({ content: [], structuredContent: { ok: true, settings: settings() } })
    .mockResolvedValueOnce({
      content: [],
      structuredContent: { ok: true, settings: { lease: {} } },
    });
  const client = new AssignmentService({ callTool, close: vi.fn() });
  expect(await client.settings()).toEqual(settings());
  expect(callTool).toHaveBeenCalledWith({ name: "get_lifecycle_settings", arguments: {} });
  await expect(client.settings()).rejects.not.toBeInstanceOf(UncertainAssignmentWriteError);
});
