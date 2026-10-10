import {
  validateDelegate,
  validatePrincipal,
  type DelegateInput,
} from "../_shared/task-contracts.ts";
export type TaskRequest =
  | ({ operation: "delegate" } & DelegateInput)
  | { operation: "claim"; projects: string[]; task_id?: string }
  | { operation: "list_owned"; cursor?: string }
  | { operation: "bind"; task_id: string; session_id: string }
  | { operation: "finalize"; task_id: string; report: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: string[], optional: string[] = []) {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !optional.includes(key) && !Object.hasOwn(value, key))
  )
    throw new Error("Invalid request");
}
export function parseRequest(value: unknown): TaskRequest {
  const body = record(value);
  switch (body.operation) {
    case "delegate": {
      const { operation, ...input } = body;
      return { operation, ...validateDelegate(input) };
    }
    case "claim":
      closed(body, ["operation", "projects", "task_id"], ["task_id"]);
      if (
        Object.hasOwn(body, "task_id") &&
        (typeof body.task_id !== "string" || !uuid.test(body.task_id))
      )
        throw new Error("Invalid task ID");
      validatePrincipal({ role: "pm", projects: body.projects });
      if ((body.projects as string[]).length === 0) throw new Error("Invalid request");
      break;
    case "list_owned":
      closed(body, ["operation", "cursor"], ["cursor"]);
      if (Object.hasOwn(body, "cursor")) {
        if (typeof body.cursor !== "string") throw new Error("Invalid cursor");
        decodeCursor(body.cursor);
      }
      break;
    case "bind":
    case "finalize":
      closed(body, ["operation", "task_id", body.operation === "bind" ? "session_id" : "report"]);
      if (typeof body.task_id !== "string" || !uuid.test(body.task_id))
        throw new Error("Invalid task ID");
      if (
        body.operation === "bind" &&
        (typeof body.session_id !== "string" ||
          !body.session_id.trim() ||
          [...body.session_id].length > 256)
      )
        throw new Error("Invalid session ID");
      break;
    default:
      throw new Error("Invalid operation");
  }
  return body as TaskRequest;
}
export function encodeCursor(key: { created_at: string; id: string }): string {
  return btoa(JSON.stringify({ created_at: key.created_at, id: key.id }));
}
export function decodeCursor(value: string): { created_at: string; id: string } {
  if (value.length > 512) throw new Error("Invalid cursor");
  const key = record(JSON.parse(atob(value)));
  closed(key, ["created_at", "id"]);
  const time =
    typeof key.created_at === "string"
      ? key.created_at.match(
          /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/,
        )
      : null;
  const year = Number(time?.[1]);
  const month = Number(time?.[2]);
  const day = Number(time?.[3]);
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    typeof key.id !== "string" ||
    !uuid.test(key.id) ||
    typeof key.created_at !== "string" ||
    !time ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    !Number.isFinite(Date.parse(key.created_at))
  )
    throw new Error("Invalid cursor");
  return key as { created_at: string; id: string };
}
