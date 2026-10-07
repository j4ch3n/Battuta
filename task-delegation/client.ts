import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
import {
  validateDelegate,
  validateTaskRow,
  type DelegateInput,
  type TaskRow,
  type TerminalReport,
} from "../supabase/functions/_shared/task-contracts.ts";

export class UncertainTaskWriteError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(
      `Task ${operation} outcome is uncertain; reconcile before retrying with the same identity`,
    );
    this.name = "UncertainTaskWriteError";
    this.operation = operation;
  }
}
export function boundedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export class TaskClient {
  private readonly supabase: SupabaseClient;
  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }
  private async request<T>(
    operation: string,
    fields: Record<string, unknown>,
    parse: (data: unknown) => T,
    write: boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      const result = await this.supabase.functions.invoke<unknown>("task-pool", {
        body: { operation, ...fields },
        signal: boundedSignal(signal),
      });
      const { data, error } = result as { data: unknown; error: unknown };
      if (error) throw error instanceof Error ? error : new Error("Task API request failed");
      return parse(data);
    } catch (error) {
      // Explicit validation/auth/conflict/rate-limit rejections are definitive.
      // Timeouts (including HTTP 408) do not prove that the write was rolled back.
      if (
        write &&
        !(
          error instanceof FunctionsHttpError &&
          error.context instanceof Response &&
          [400, 401, 403, 404, 409, 422, 429].includes(error.context.status)
        )
      )
        throw new UncertainTaskWriteError(operation);
      throw error;
    }
  }
  delegate(input: DelegateInput, signal?: AbortSignal): Promise<TaskRow> {
    const validated = validateDelegate(input);
    return this.request(
      "delegate",
      { ...validated },
      (data) => {
        const task = validateTaskRow(data);
        if (
          task.key !== validated.key ||
          task.project !== validated.project ||
          task.ticket_id !== (validated.ticket_id ?? null) ||
          !isDeepStrictEqual(task.instruction, validated.instruction)
        )
          throw new Error("Unexpected delegation acknowledgement");
        return task;
      },
      true,
      signal,
    );
  }
  claim(projects: string[], signal?: AbortSignal): Promise<TaskRow | null> {
    return this.request(
      "claim",
      { projects },
      (data) => {
        if (data === null) return null;
        const task = validateTaskRow(data);
        if (
          task.claimed_by === null ||
          task.terminal_report !== null ||
          !projects.includes(task.project)
        )
          throw new Error("Unexpected claim acknowledgement");
        return task;
      },
      true,
      signal,
    );
  }
  listOwned(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ tasks: TaskRow[]; next: string | null }> {
    return this.request(
      "list_owned",
      { ...(cursor === undefined ? {} : { cursor }) },
      (data) => {
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid owned tasks response");
        const value = data as Record<string, unknown>;
        if (
          Object.keys(value).length !== 2 ||
          !Array.isArray(value.tasks) ||
          !(value.next === null || (typeof value.next === "string" && value.next.trim().length > 0))
        )
          throw new Error("Invalid owned tasks response");
        const tasks = value.tasks.map(validateTaskRow);
        if (tasks.some((task) => task.claimed_by === null || task.terminal_report !== null))
          throw new Error("Unexpected owned task");
        return { tasks, next: value.next };
      },
      false,
      signal,
    );
  }
  private taskResponse(taskId: string, data: unknown): TaskRow {
    const task = validateTaskRow(data);
    if (task.id !== taskId) throw new Error("Unexpected task identity");
    return task;
  }
  bind(taskId: string, sessionId: string, signal?: AbortSignal): Promise<TaskRow> {
    return this.request(
      "bind",
      { task_id: taskId, session_id: sessionId },
      (data) => {
        const task = this.taskResponse(taskId, data);
        if (task.opencode_session_id !== sessionId)
          throw new Error("Unexpected binding acknowledgement");
        return task;
      },
      true,
      signal,
    );
  }
  finalize(taskId: string, report: TerminalReport, signal?: AbortSignal): Promise<TaskRow> {
    return this.request(
      "finalize",
      { task_id: taskId, report },
      (data) => {
        const task = this.taskResponse(taskId, data);
        if (!isDeepStrictEqual(task.terminal_report, report))
          throw new Error("Unexpected finalization acknowledgement");
        return task;
      },
      true,
      signal,
    );
  }
}
