import assert from "node:assert/strict";
import { createAssignmentHandler, type Rpc } from "./server.ts";

const assignment = {
  id: "a3f91c2e",
  project: "Atlas",
  goal: "Goal",
  constraints: "",
  status: "active",
  notes_path: null,
  created_at: "2026-11-04T12:00:00+00:00",
  updated_at: "2026-11-04T12:00:00+00:00",
  closed_at: null,
  claimed_at: null,
  claimed_by: null,
  require_abilities: [],
  lease_expired_at: null,
  blocker: null,
  dependencies: [],
  ready: true,
};

async function call(
  rpc: Rpc,
  name: string,
  args: Record<string, unknown>,
  rootHeader: string | null = encodeURIComponent("/local/.battuta/projects"),
  handler = createAssignmentHandler(rpc),
) {
  const response = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(rootHeader === null ? {} : { "X-Battuta-Projects-Root": rootHeader }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await response.text();
  const payload = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice(6)
    : text;
  return JSON.parse(payload).result;
}

Deno.test(
  "unknown specialists refuse before RPC with readable text and typed recovery data",
  async () => {
    for (const [name, input] of [
      [
        "create_assignment",
        {
          project: "Atlas",
          goal: "Goal",
          initial_todos: ["Step"],
          require_abilities: ["mobile_browse"],
        },
      ],
      [
        "claim_assignment",
        {
          project: "Atlas",
          assignment_id: "a3f91c2e",
          claimed_by: "worker-1",
          abilities: ["mobile_use"],
        },
      ],
    ] as const) {
      let calls = 0;
      const result = await call(
        () => {
          calls++;
          return Promise.resolve({ data: null, error: null });
        },
        name,
        input,
      );
      assert.equal(calls, 0);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.code, "unknown_abilities");
      assert.deepEqual(result.structuredContent.suggestions, {});
      assert.equal(result.content[0].text.startsWith("{"), false);
      assert.match(result.content[0].text, /catalog is empty/i);
      assert.match(result.content[0].text, /\[\]/);
      assert.match(result.content[0].text, /mobile_/);
    }
  },
);

Deno.test(
  "MCP preserves exact update target/token and exposes structured business refusals",
  async () => {
    const token = "2026-11-04T12:00:00.123456+00:00";
    const result = await call(
      (name, args) => {
        assert.equal(name, "assignment_update_todo");
        assert.deepEqual(args, {
          p_project: "Atlas",
          p_assignment_id: "a3f91c2e",
          p_position: 2,
          p_expected_updated_at: token,
          p_status: "cancelled",
        });
        return Promise.resolve({
          data: {
            ok: false,
            code: "assignment_closed",
            message: "Closed",
            assignment: {
              ...assignment,
              status: "cancelled",
              closed_at: assignment.updated_at,
              ready: false,
            },
          },
          error: null,
        });
      },
      "update_todo",
      {
        project: "Atlas",
        assignment_id: "a3f91c2e",
        position: 2,
        expected_updated_at: token,
        status: "cancelled",
      },
    );
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "assignment_closed");
  },
);

Deno.test("MCP sanitizes backend errors, throws, and malformed output", async () => {
  for (const rpc of [
    () => Promise.resolve({ data: null, error: { message: "private-sentinel", code: "500" } }),
    () => Promise.reject(new Error("private-sentinel")),
    () => Promise.resolve({ data: { ok: true, assignments: "private-sentinel" }, error: null }),
  ]) {
    const result = await call(rpc, "list_assignments", { project: "Atlas" });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "backend_error");
    assert.equal(JSON.stringify(result).includes("private-sentinel"), false);
  }
});

Deno.test("note tools return existing path and editability with user-facing guidance", async () => {
  for (const status of ["active", "in_process", "blocked", "done", "cancelled"]) {
    for (const tool of ["prepare_notes", "locate_notes"]) {
      const notes_path = "/old-host/.battuta/projects/Atlas/work/a3f91c2e/note.md";
      const notes_ref = "Atlas/work/a3f91c2e/note.md";
      const result = await call(
        () =>
          Promise.resolve({
            data: {
              ok: true,
              notes_ref,
              editable: !["done", "cancelled"].includes(status),
              assignment: {
                ...assignment,
                id: "a3f91c2e",
                project: "Atlas",
                goal: "Goal",
                constraints: "",
                status,
                claimed_at: ["in_process", "blocked"].includes(status)
                  ? assignment.created_at
                  : null,
                lease_expired_at: ["in_process", "blocked"].includes(status)
                  ? "2026-11-04T12:45:00+00:00"
                  : null,
                blocker: status === "blocked" ? "Missing input" : null,
                ready: status === "active",
                notes_path,
                created_at: "2026-11-04T12:00:00+00:00",
                updated_at: "2026-11-04T12:00:00+00:00",
                closed_at: ["done", "cancelled"].includes(status)
                  ? "2026-11-04T12:00:00+00:00"
                  : null,
              },
            },
            error: null,
          }),
        tool,
        {
          project: "Atlas",
          assignment_id: "a3f91c2e",
        },
      );
      assert.equal(result.structuredContent.notes_ref, undefined);
      assert.equal(result.structuredContent.notes_path, `/local/.battuta/projects/${notes_ref}`);
      assert.equal(result.structuredContent.editable, !["done", "cancelled"].includes(status));
      assert.equal(typeof result.structuredContent.guidance, "string");
      assert.ok(result.structuredContent.guidance.trim().length > 0);
    }
  }
});

Deno.test(
  "note reference validation rejects remote paths, traversal and unrelated assignments",
  async () => {
    for (const notes_ref of [
      "/other-host/note.md",
      "../work/a3f91c2e/note.md",
      "Other/work/a3f91c2e/note.md",
      "projects/Atlas/work/a3f91c2e/note.md",
    ]) {
      const response = await call(
        () =>
          Promise.resolve({
            data: { ok: true, assignment, notes_ref, editable: true },
            error: null,
          }),
        "locate_notes",
        { project: assignment.project, assignment_id: assignment.id },
      );
      assert.equal(response.isError, true);
      assert.equal(response.structuredContent?.notes_ref, undefined);
    }
  },
);

Deno.test("note roots are caller metadata and invalid roots refuse before RPC", async () => {
  for (const root of [
    null,
    "",
    "relative",
    "~/.battuta/projects",
    "/local/../escape",
    "/local/./projects",
    "/local\\projects",
    "/local/\u0000projects",
    "/local/\nprojects",
    "${PROJECTS_ROOT}",
  ]) {
    for (const name of ["prepare_notes", "locate_notes"]) {
      let calls = 0;
      const result = await call(
        () => {
          calls++;
          return Promise.resolve({ data: null, error: null });
        },
        name,
        { project: assignment.project, assignment_id: assignment.id },
        root === null ? null : encodeURIComponent(root),
      );
      assert.equal(calls, 0);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.code, "invalid_input");
      assert.equal(result.content[0].text.startsWith("{"), false);
    }
  }
  const malformed = await call(
    () => {
      throw new Error("must not reach RPC");
    },
    "prepare_notes",
    { project: assignment.project, assignment_id: assignment.id },
    "%ZZ",
  );
  assert.equal(malformed.structuredContent.code, "invalid_input");
  const listed = await call(
    () => Promise.resolve({ data: { ok: true, assignments: [] }, error: null }),
    "list_assignments",
    {},
    null,
  );
  assert.equal(listed.isError, false);
});

Deno.test("note paths are resolved per request, decoding caller roots exactly once", async () => {
  const rpc: Rpc = (_name, args) => {
    assert.deepEqual(args, { p_project: assignment.project, p_assignment_id: assignment.id });
    return Promise.resolve({
      data: { ok: true, assignment, notes_ref: "Atlas/work/a3f91c2e/note.md", editable: true },
      error: null,
    });
  };
  const handler = createAssignmentHandler(rpc);
  const roots = ["/home/worker-a/.battuta/projects/", "/Users/测试 space%2F#/.battuta/projects"];
  const results = await Promise.all(
    roots.map((root) =>
      call(
        rpc,
        "prepare_notes",
        { project: assignment.project, assignment_id: assignment.id },
        encodeURIComponent(root),
        handler,
      ),
    ),
  );
  for (const [index, result] of results.entries()) {
    assert.equal(result.isError, false);
    assert.equal(
      result.structuredContent.notes_path,
      `${roots[index].replace(/\/$/, "")}/Atlas/work/a3f91c2e/note.md`,
    );
    assert.equal(result.structuredContent.notes_ref, undefined);
  }
});

Deno.test("closed unprepared notes have no invented local path", async () => {
  const result = await call(
    () =>
      Promise.resolve({
        data: {
          ok: true,
          assignment: { ...assignment, status: "done" },
          notes_ref: null,
          editable: false,
        },
        error: null,
      }),
    "locate_notes",
    { project: assignment.project, assignment_id: assignment.id },
  );
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.notes_path, null);
});

Deno.test(
  "claim-bound writes preserve exact claim tokens and incomplete recovery data is rejected",
  async () => {
    const claimed_at = "2026-11-04T12:00:00.123456+00:00";
    const result = await call(
      (name, args) => {
        assert.equal(name, "assignment_block");
        assert.equal(args.p_claimed_at, claimed_at);
        return Promise.resolve({
          data: { ok: false, code: "stale_claim", message: "Inspect", assignment },
          error: null,
        });
      },
      "block_assignment",
      { project: "Atlas", assignment_id: "a3f91c2e", claimed_at, blocker: "Provider unavailable" },
    );
    assert.equal(result.structuredContent.code, "stale_claim");
    const malformed = await call(
      () =>
        Promise.resolve({
          data: { ok: false, code: "missing_dependencies", message: "Inspect" },
          error: null,
        }),
      "create_assignment",
      { project: "Atlas", goal: "Goal", initial_todos: ["Step"] },
    );
    assert.equal(malformed.structuredContent.code, "backend_error");
  },
);
