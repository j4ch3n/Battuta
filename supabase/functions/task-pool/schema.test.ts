import { assertEquals, assertThrows } from "@std/assert";
import { decodeCursor, encodeCursor, parseRequest } from "./schema.ts";

Deno.test("closed operation bodies and validated keyset cursors", () => {
  assertEquals(parseRequest({ operation: "claim", projects: ["Battuta"] }), {
    operation: "claim",
    projects: ["Battuta"],
  });
  assertEquals(parseRequest({ operation: "list_owned" }), { operation: "list_owned" });
  const key = {
    created_at: "2026-10-07T00:00:00.123456+00:00",
    id: "12345678-1234-4234-8234-123456789abc",
  };
  assertEquals(decodeCursor(encodeCursor(key)), key);
  const row = { ...key, project: "Battuta" };
  assertEquals(decodeCursor(encodeCursor(row)), key);
  for (const value of [
    null,
    {},
    { operation: "cancel" },
    { operation: "claim", projects: ["../other"] },
    { operation: "claim", projects: [] },
    { operation: "claim", projects: ["Battuta"], worker_id: "spoof" },
    { operation: "bind", task_id: "bad", session_id: "s" },
    { operation: "list_owned", cursor: "garbage" },
  ])
    assertThrows(() => parseRequest(value));
  assertThrows(() => decodeCursor(btoa(JSON.stringify({ ...key, created_at: "invalid" }))));
  assertThrows(() => decodeCursor("x".repeat(513)));
  for (const created_at of [
    "2026-02-30T00:00:00Z",
    "2026-10-07T24:00:00Z",
    "0000-10-07T00:00:00Z",
    "2026-10-07T00:00:00+18:00",
  ])
    assertThrows(() => decodeCursor(btoa(JSON.stringify({ ...key, created_at }))));
});
Deno.test("operation parsing validates delegation and closed bind/finalize shapes", () => {
  const instruction = {
    schema_version: 1,
    summary: "Task",
    objective: "Work",
    scope: ["Parser"],
    constraints: [],
    inputs: [],
    acceptance_criteria: [{ id: "c1", expectation: "Pass" }],
    deliverables: ["Tests"],
  };
  const delegation = { operation: "delegate", key: "k", project: "Battuta", instruction };
  assertEquals<unknown>(parseRequest(delegation), delegation);
  assertThrows(() =>
    parseRequest({ ...delegation, instruction: { ...instruction, unknown: true } }),
  );
  const task_id = "12345678-1234-4234-8234-123456789abc";
  assertEquals(parseRequest({ operation: "bind", task_id, session_id: "s" }), {
    operation: "bind",
    task_id,
    session_id: "s",
  });
  assertEquals(parseRequest({ operation: "finalize", task_id, report: {} }), {
    operation: "finalize",
    task_id,
    report: {},
  });
  for (const body of [
    { operation: "bind", task_id, session_id: " " },
    { operation: "bind", task_id, session_id: "s".repeat(257) },
    { operation: "finalize", task_id, report: {}, recipient: "pm" },
    { operation: "list_owned", cursor: null },
  ])
    assertThrows(() => parseRequest(body));
});
