import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Static, TSchema } from "typebox";
import {
  AssignedSchema,
  DetailSchema,
  ProgressSchema,
  ListSchema,
  FailureSchema,
  parseValue,
} from "./contracts.ts";
import type {
  AssignmentClient,
  AssignmentClientConfig,
  AssignmentFailure,
  Target,
  TodoTarget,
  Claim,
  ExecutionResult,
  AssignmentView,
  Detail,
} from "./types.ts";

export class AssignmentRefusalError extends Error {
  readonly refusal: AssignmentFailure;
  constructor(refusal: AssignmentFailure) {
    super(refusal.message);
    this.refusal = refusal;
  }
}
export class UncertainAssignmentWriteError extends Error {}

export async function blockAndInspect(
  client: Pick<AssignmentClient, "block" | "get">,
  claim: Claim,
  blocker: string,
): Promise<Detail> {
  try {
    await client.block({ ...claim, blocker });
  } catch (error) {
    if (!(error instanceof UncertainAssignmentWriteError)) throw error;
  }
  const detail = await client.get(claim),
    row = detail.assignment;
  if (
    row.project !== claim.project ||
    row.id !== claim.assignment_id ||
    row.claimed_at !== claim.claimed_at ||
    row.status !== "blocked" ||
    row.blocker !== blocker
  ) {
    throw new Error("Execution blocker remains unconfirmed; inspect before repeating");
  }
  return detail;
}

export class AssignmentService implements AssignmentClient {
  private readonly client: Pick<Client, "callTool" | "close">;
  constructor(client: Pick<Client, "callTool" | "close">) {
    this.client = client;
  }
  private async call<T extends TSchema>(
    name: string,
    args: object,
    schema: T,
    write = true,
  ): Promise<Static<T>> {
    try {
      const response = await this.client.callTool({ name, arguments: { ...args } });
      const data = response.structuredContent;
      if (
        response.isError ||
        (data && typeof data === "object" && "ok" in data && data.ok === false)
      ) {
        const refusal = parseValue(FailureSchema, data);
        if (refusal.code === "backend_error") throw new Error("Unconfirmed backend result");
        if (refusal.code === "invalid_transition" && !refusal.assignment && !refusal.todo)
          throw new Error("Missing recovery state");
        throw new AssignmentRefusalError(refusal);
      }
      return parseValue(schema, data);
    } catch (error) {
      if (error instanceof AssignmentRefusalError) throw error;
      if (write)
        throw new UncertainAssignmentWriteError(
          "Assignment write could not be confirmed; inspect before repeating",
        );
      throw new Error("Assignment read failed; no work state could be confirmed", { cause: error });
    }
  }
  list(input: { project?: string; status?: AssignmentView["status"] }) {
    return this.call("list_assignments", input, ListSchema, false);
  }
  get({ project, assignment_id }: Target) {
    return this.call("get_assignment", { project, assignment_id }, DetailSchema, false);
  }
  claim({ project, assignment_id }: Target) {
    return this.call("claim_assignment", { project, assignment_id }, DetailSchema);
  }
  start({ project, assignment_id, claimed_at, position, expected_updated_at }: TodoTarget) {
    return this.call(
      "start_todo",
      { project, assignment_id, claimed_at, position, expected_updated_at },
      ProgressSchema,
    );
  }
  record(input: TodoTarget & ExecutionResult) {
    const {
      project,
      assignment_id,
      claimed_at,
      position,
      expected_updated_at,
      outcome,
      summary,
      evidence,
    } = input;
    return this.call(
      "record_todo_result",
      {
        project,
        assignment_id,
        claimed_at,
        position,
        expected_updated_at,
        outcome,
        summary,
        evidence,
        ...(input.outcome === "blocked" ? { blocker: input.blocker } : {}),
      },
      ProgressSchema,
    );
  }
  block({ project, assignment_id, claimed_at, blocker }: Claim & { blocker: string }) {
    return this.call(
      "block_assignment",
      { project, assignment_id, claimed_at, blocker },
      AssignedSchema,
    );
  }
  finish({ project, assignment_id, claimed_at }: Claim) {
    return this.call("finish_assignment", { project, assignment_id, claimed_at }, AssignedSchema);
  }
  close() {
    return this.client.close();
  }
}

export async function createAssignmentClient(
  config: AssignmentClientConfig,
): Promise<AssignmentClient> {
  const url = new URL(config.supabaseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    ) ||
    !config.secretKey.trim()
  )
    throw new Error("Invalid private assignment client configuration");
  const client = new Client({ name: "battuta-worker", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/functions/v1/assignments", url), {
        requestInit: { headers: { apikey: config.secretKey } },
      }),
    );
    return new AssignmentService(client);
  } catch {
    await client.close().catch(() => {});
    throw new Error("Could not connect to the assignment service");
  }
}
