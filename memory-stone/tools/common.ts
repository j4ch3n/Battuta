import { Type } from "typebox";
import type { MemoryRecord } from "../stone.ts";
import type { ProjectBinding } from "../binding.ts";

export const scopeSchema = Type.Union([Type.Literal("project"), Type.Literal("global")]);
export const kindSchema = Type.Union(
  ["decision", "preference", "task", "error_resolution", "turn_summary", "session_summary"].map(
    (value) => Type.Literal(value),
  ),
);
export const result = (text: string, details: unknown = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});
export const scopeLabel = (scope: string, binding: ProjectBinding | null) =>
  scope === "global" ? "global" : `project: ${binding?.name ?? "unselected"}`;
export const displayRecord = (record: MemoryRecord, binding: ProjectBinding | null) =>
  `[${scopeLabel(record.scope, binding)}; ${record.kind}; ref=${record.id}] ${record.text}`;
export async function handle(
  operation: () => ReturnType<typeof result> | Promise<ReturnType<typeof result>>,
) {
  try {
    return await operation();
  } catch (error) {
    return result(error instanceof Error ? error.message : String(error), { error: true });
  }
}
