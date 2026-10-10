import { resolvePrincipal, TaskError, type GetUser } from "./principal.ts";
import { decodeCursor, encodeCursor, parseRequest } from "./schema.ts";
import { validateReport, validateTaskRow } from "../_shared/task-contracts.ts";
export interface Dependencies {
  getUser: GetUser;
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>;
}
export function createHandler(deps: Dependencies): (req: Request) => Promise<Response> {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await deps.rpc(name, args);
    if (error) {
      const status =
        error.code === "PT403"
          ? 403
          : error.code === "PT409" || error.code === "23505"
            ? 409
            : error.code === "22023" || error.code === "23514"
              ? 400
              : 500;
      throw new TaskError(
        status,
        status === 500
          ? "Task operation failed"
          : status === 403
            ? "Task forbidden"
            : status === 409
              ? "Task conflict"
              : "Invalid task request",
      );
    }
    return data;
  }
  return async (req) => {
    if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
    try {
      const principal = await resolvePrincipal(req.headers.get("authorization"), deps.getUser);
      let body;
      try {
        const text = await req.text();
        if (new TextEncoder().encode(text).length > 140000) throw new Error("Too large");
        body = parseRequest(JSON.parse(text));
      } catch {
        throw new TaskError(400, "Invalid task request");
      }
      const allowed = (project: string) => {
        if (!principal.projects.includes(project)) throw new TaskError(403, "Task forbidden");
      };
      if (body.operation === "delegate") {
        if (principal.role === "worker") throw new TaskError(403, "Task forbidden");
        allowed(body.project);
        return Response.json(
          await rpc("task_pool_delegate", {
            p_role: principal.role,
            p_key: body.key,
            p_project: body.project,
            p_ticket_id: body.ticket_id ?? null,
            p_instruction: body.instruction,
          }),
        );
      }
      if (principal.role !== "worker") throw new TaskError(403, "Task forbidden");
      const owner = { p_worker_id: principal.worker_id };
      if (body.operation === "claim") {
        body.projects.forEach(allowed);
        const data = await rpc("task_pool_claim", {
          ...owner,
          p_projects: body.projects,
          ...(body.task_id === undefined ? {} : { p_task_id: body.task_id }),
        });
        // PostgREST serializes a SQL NULL composite as an object of NULL columns.
        if (
          data === null ||
          (data &&
            typeof data === "object" &&
            "id" in data &&
            data.id === null &&
            Object.values(data).every((value) => value === null))
        )
          return Response.json(null);
        const task = validateTaskRow(data);
        if (
          task.claimed_by !== principal.worker_id ||
          task.terminal_report !== null ||
          !body.projects.includes(task.project) ||
          (body.task_id !== undefined && task.id !== body.task_id)
        )
          throw new Error("Invalid claim response");
        return Response.json(task);
      }
      if (body.operation === "list_owned") {
        const cursor = body.cursor ? decodeCursor(body.cursor) : null;
        const rows = await rpc("task_pool_list_owned", {
          ...owner,
          p_after_created_at: cursor?.created_at ?? null,
          p_after_id: cursor?.id ?? null,
          p_limit: 101,
        });
        if (!Array.isArray(rows)) throw new Error("Invalid RPC response");
        const tasks = rows.map(validateTaskRow);
        tasks.forEach((task) => allowed(task.project));
        const page = tasks.slice(0, 100);
        return Response.json({
          tasks: page,
          next: tasks.length > 100 ? encodeCursor(page[99]) : null,
        });
      }
      const args = { ...owner, p_task_id: body.task_id };
      const stored = await rpc("task_pool_get_owned", args);
      if (!stored) throw new TaskError(403, "Task forbidden");
      const task = validateTaskRow(stored);
      allowed(task.project);
      if (task.claimed_by !== principal.worker_id) throw new TaskError(403, "Task forbidden");
      if (body.operation === "bind")
        return Response.json(
          await rpc("task_pool_bind", { ...args, p_session_id: body.session_id }),
        );
      // Let the RPC classify differing terminal retries as conflicts before report validation.
      if (task.terminal_report === null) {
        try {
          validateReport(body.report, task.instruction);
        } catch {
          throw new TaskError(400, "Invalid task report");
        }
      }
      return Response.json(await rpc("task_pool_finalize", { ...args, p_report: body.report }));
    } catch (error) {
      return Response.json(
        { error: error instanceof TaskError ? error.message : "Task operation failed" },
        { status: error instanceof TaskError ? error.status : 500 },
      );
    }
  };
}
