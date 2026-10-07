import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTaskConnection } from "./auth.ts";
import { UncertainTaskWriteError } from "./client.ts";
import {
  DelegateInputSchema,
  deriveState,
  validateDelegate,
  type DelegateInput,
} from "../supabase/functions/_shared/task-contracts.ts";

export default function (pi: ExtensionAPI) {
  type Connection = Awaited<ReturnType<typeof createTaskConnection>>;
  let connection: Promise<Connection> | undefined;
  let closed = false;
  let stopping: Promise<void> | undefined;
  const shutdown = new AbortController();
  const outstanding = new Set<Promise<unknown>>();
  async function close(access: Connection) {
    try {
      await access.close();
    } catch {
      throw new Error("Task authentication cleanup failed; check task access resources");
    }
  }
  const required = (key: string) => {
    const value = process.env[key];
    if (!value)
      throw new Error(`Task delegation requires ${key}; configure task access for this bot`);
    return value;
  };
  function connect(): Promise<Connection> {
    if (connection) return connection;
    const role = required("AGENT_ROLE");
    if (role !== "pm" && role !== "tl")
      throw new Error("Task delegation requires AGENT_ROLE pm or tl");
    const prefix = role.toUpperCase();
    const options = {
      url: required("SUPABASE_URL"),
      publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
      email: required(`${prefix}_TASK_EMAIL`),
      password: required(`${prefix}_TASK_PASSWORD`),
    };
    connection = createTaskConnection(options).then(async (result) => {
      if (closed || result.principal.role !== role) {
        await close(result);
        throw new Error(
          closed
            ? "Task delegation is shut down"
            : "Configured task role does not match verified principal role",
        );
      }
      return result;
    });
    // Permit fixing configuration/auth and explicitly trying the tool again.
    void connection.catch(() => {
      connection = undefined;
    });
    return connection;
  }
  async function delegate(args: unknown, signal?: AbortSignal) {
    const input = validateDelegate(args);
    if (closed) throw new Error("Task delegation is shut down");
    const access = await connect();
    if (closed) throw new Error("Task delegation is shut down");
    let task;
    try {
      task = await access.client.delegate(
        input,
        signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal,
      );
      if (task.delegator_role !== access.principal.role)
        throw new UncertainTaskWriteError("delegate");
    } catch (error) {
      if (error instanceof UncertainTaskWriteError) throw error;
      // SDK diagnostics may include private execution IDs or credentials.
      // eslint-disable-next-line preserve-caught-error -- A cause would leak the intentionally redacted SDK diagnostics.
      throw new Error(
        "Task delegation rejected; check task access and delegation key/payload before retrying",
      );
    }
    const state = deriveState(task);
    return {
      content: [
        {
          type: "text" as const,
          text: `Task ${state}: ${task.instruction.summary}${task.ticket_id ? ` (${task.ticket_id})` : ""}`,
        },
      ],
      details: { task_id: task.id, state },
    };
  }
  pi.registerTool({
    name: "delegate_task",
    label: "Delegate task",
    description:
      "Persist self-contained work for a background worker. Use a unique key; identical retries return the current state. Queued means saved, not started or completed. Instructions are immutable; intentional re-execution needs a new key.",
    parameters: Type.Unsafe<DelegateInput>(DelegateInputSchema),
    execute(_id, args, signal) {
      const work = delegate(args, signal);
      outstanding.add(work);
      void work.finally(() => outstanding.delete(work)).catch(() => undefined);
      return work;
    },
  });
  pi.on("session_shutdown", () => {
    if (stopping) return stopping;
    closed = true;
    shutdown.abort();
    stopping = (async () => {
      await Promise.allSettled([...outstanding]);
      const access = await connection?.catch(() => undefined);
      if (access) await close(access);
    })();
    return stopping;
  });
}
