import {
  FunctionsHttpError,
  FunctionsFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { TaskClient, UncertainTaskWriteError } from "../client.ts";

const instruction = {
  schema_version: 1 as const,
  summary: "Fix parser",
  objective: "Parse safely",
  scope: ["Parser"],
  constraints: [],
  inputs: [],
  acceptance_criteria: [{ id: "c1", expectation: "Tests pass" }],
  deliverables: ["Tests"],
};
const input = { key: "key-1", project: "Battuta", instruction };
const row = {
  id: "12345678-1234-4234-8234-123456789abc",
  ...input,
  ticket_id: null,
  delegator_role: "pm",
  created_at: "2026-10-07T00:00:00Z",
  claimed_by: null,
  claimed_at: null,
  opencode_session_id: null,
  terminal_report: null,
  finished_at: null,
  result_message_ref: null,
};
function setup(data: unknown = row, error: unknown = null) {
  const invoke = vi
    .fn<
      (
        _name: string,
        options: { body: unknown; signal: AbortSignal },
      ) => Promise<{ data: unknown; error: unknown }>
    >()
    .mockResolvedValue({ data, error });
  return { invoke, client: new TaskClient({ functions: { invoke } } as unknown as SupabaseClient) };
}
it("sends only delegation fields, never caller role/worker identity, with bounded signals", async () => {
  const { client, invoke } = setup();
  expect(await client.delegate(input)).toEqual(row);
  const [name, options] = invoke.mock.calls[0] as [string, { body: unknown; signal: AbortSignal }];
  expect(name).toBe("task-pool");
  expect(options.body).toEqual({ operation: "delegate", ...input });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(() => client.delegate({ ...input, role: "tl" } as typeof input)).toThrow();
});
it("routes claim/list/bind/finalize without caller identity", async () => {
  const { client, invoke } = setup(null);
  expect(await client.claim(["Battuta"])).toBeNull();
  expect(invoke.mock.calls[0]?.[1].body).toEqual({ operation: "claim", projects: ["Battuta"] });
  const owned = { ...row, claimed_by: "host", claimed_at: row.created_at };
  invoke.mockResolvedValueOnce({ data: { tasks: [owned], next: "cursor-1" }, error: null });
  expect(await client.listOwned("cursor-0")).toEqual({ tasks: [owned], next: "cursor-1" });
  expect(invoke.mock.calls[1]?.[1].body).toEqual({ operation: "list_owned", cursor: "cursor-0" });
  const bound = {
    ...row,
    claimed_by: "host",
    claimed_at: row.created_at,
    opencode_session_id: "session-1",
  };
  invoke.mockResolvedValueOnce({ data: bound, error: null });
  expect(await client.bind(row.id, "session-1")).toEqual(bound);
  expect(invoke.mock.calls[2]?.[1].body).toEqual({
    operation: "bind",
    task_id: row.id,
    session_id: "session-1",
  });
  const report = {
    schema_version: 1 as const,
    state: "failed" as const,
    summary: "Failed",
    checks: [],
    artifacts: [],
    failure: "Build failed",
  };
  const finished = {
    ...bound,
    terminal_report: report,
    finished_at: row.created_at,
    result_message_ref: { conversation_id: row.id, id: "abcdef123456" },
  };
  invoke.mockResolvedValueOnce({ data: finished, error: null });
  expect(await client.finalize(row.id, report)).toEqual(finished);
  expect(invoke.mock.calls[3]?.[1].body).toEqual({
    operation: "finalize",
    task_id: row.id,
    report,
  });
});
it("claims only the requested task identity and rejects a different acknowledgement without retry", async () => {
  const owned = { ...row, claimed_by: "host", claimed_at: row.created_at };
  const { client, invoke } = setup(owned);
  expect(await client.claim(["Battuta"], undefined, row.id)).toEqual(owned);
  expect(invoke.mock.calls[0]?.[1].body).toEqual({
    operation: "claim",
    projects: ["Battuta"],
    task_id: row.id,
  });
  invoke.mockResolvedValueOnce({
    data: { ...owned, id: "22345678-1234-4234-8234-123456789abc" },
    error: null,
  });
  await expect(client.claim(["Battuta"], undefined, row.id)).rejects.toBeInstanceOf(
    UncertainTaskWriteError,
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});
it.each(["queued", "terminal"])("rejects %s rows in unfinished owned pages", async (state) => {
  const task =
    state === "queued"
      ? row
      : {
          ...row,
          claimed_by: "host",
          claimed_at: row.created_at,
          terminal_report: {
            schema_version: 1,
            state: "failed",
            summary: "Failed",
            checks: [],
            artifacts: [],
            failure: "Build failed",
          },
          finished_at: row.created_at,
          result_message_ref: { conversation_id: row.id, id: "abcdef123456" },
        };
  await expect(setup({ tasks: [task], next: null }).client.listOwned()).rejects.toThrow(
    "Unexpected owned task",
  );
});
it.each([
  new FunctionsFetchError(new Error("offline")),
  new FunctionsHttpError(new Response("error", { status: 500 })),
  new FunctionsHttpError(new Response("timeout", { status: 408 })),
  null,
])("surfaces unknown write outcomes without retries (%j)", async (error) => {
  const { client, invoke } = setup({ status: "queued" }, error);
  await expect(client.delegate(input)).rejects.toBeInstanceOf(UncertainTaskWriteError);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("preserves definitive rejection and read validation errors", async () => {
  const error = new FunctionsHttpError(new Response("conflict", { status: 409 }));
  const { client, invoke } = setup(null, error);
  await expect(client.delegate(input)).rejects.toBe(error);
  invoke.mockResolvedValueOnce({ data: { tasks: [], next: null, extra: true }, error: null });
  await expect(client.listOwned()).rejects.toThrow();
});
it("propagates caller abort through the bounded signal and treats thrown writes as uncertain", async () => {
  const { client, invoke } = setup();
  const controller = new AbortController();
  controller.abort();
  invoke.mockImplementationOnce((_name: string, options: { signal: AbortSignal }) => {
    options.signal.throwIfAborted();
    return Promise.reject(new Error("Expected abort"));
  });
  await expect(client.claim(["Battuta"], controller.signal)).rejects.toBeInstanceOf(
    UncertainTaskWriteError,
  );
});
it("rejects responses carrying extra columns or another task identity", async () => {
  const { client } = setup({ ...row, id: "12345678-1234-4234-8234-123456789abd" });
  await expect(client.bind(row.id, "session-1")).rejects.toBeInstanceOf(UncertainTaskWriteError);
  await expect(setup({ ...row, status: "queued" }).client.delegate(input)).rejects.toBeInstanceOf(
    UncertainTaskWriteError,
  );
});
it.each(["delegate", "claim", "bind", "finalize"])(
  "requires %s acknowledgement to reflect the requested mutation",
  async (operation) => {
    const report = {
      schema_version: 1 as const,
      state: "failed" as const,
      summary: "Failed",
      checks: [],
      artifacts: [],
      failure: "Build failed",
    };
    const { client } = setup({ ...row, key: "different" });
    const result =
      operation === "delegate"
        ? client.delegate(input)
        : operation === "claim"
          ? client.claim(["Battuta"])
          : operation === "bind"
            ? client.bind(row.id, "session-1")
            : client.finalize(row.id, report);
    await expect(result).rejects.toBeInstanceOf(UncertainTaskWriteError);
  },
);
it("validates non-null claims and owned pages, forwarding read errors without write uncertainty", async () => {
  const owned = { ...row, claimed_by: "host", claimed_at: row.created_at };
  expect(await setup(owned).client.claim(["Battuta"])).toEqual(owned);
  expect(await setup({ tasks: [], next: null }).client.listOwned()).toEqual({
    tasks: [],
    next: null,
  });
  for (const data of [null, [], { tasks: {}, next: null }, { tasks: [], next: " " }])
    await expect(setup(data).client.listOwned()).rejects.toThrow();
  await expect(setup(null, new Error("offline")).client.listOwned()).rejects.toThrow("offline");
});
