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
} from "./types.ts";

export class AssignmentRefusalError extends Error {
  constructor(readonly refusal: AssignmentFailure) {
    super(refusal.message);
  }
}
export class UncertainAssignmentWriteError extends Error {}

export class AssignmentService implements AssignmentClient {
  constructor(private readonly client: Pick<Client, "callTool" | "close">) {}
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
  get(target: Target) {
    return this.call("get_assignment", target, DetailSchema, false);
  }
  claim(target: Target) {
    return this.call("claim_assignment", target, DetailSchema);
  }
  start(target: TodoTarget) {
    return this.call("start_todo", target, ProgressSchema);
  }
  record(input: TodoTarget & ExecutionResult) {
    return this.call("record_todo_result", input, ProgressSchema);
  }
  block(input: Claim & { blocker: string }) {
    return this.call("block_assignment", input, AssignedSchema);
  }
  finish(input: Claim) {
    return this.call("finish_assignment", input, AssignedSchema);
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
