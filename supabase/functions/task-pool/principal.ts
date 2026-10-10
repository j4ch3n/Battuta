import { validatePrincipal, type Principal } from "../_shared/task-contracts.ts";
export class TaskError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type GetUser = (token: string) => Promise<{
  data: { user: { id: string; role?: string; app_metadata?: Record<string, unknown> } | null };
  error: unknown;
}>;
export async function resolvePrincipal(
  header: string | null,
  getUser: GetUser,
): Promise<Principal> {
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].startsWith("sb_"))
    throw new TaskError(401, "Task authentication required");
  let result;
  try {
    result = await getUser(match[1]);
  } catch {
    throw new TaskError(401, "Task authentication required");
  }
  const user = result.data.user;
  if (result.error || !user?.id || user.role !== "authenticated")
    throw new TaskError(401, "Task authentication required");
  try {
    return validatePrincipal(user.app_metadata?.battuta);
  } catch {
    throw new TaskError(403, "Task forbidden");
  }
}
