import { z } from "zod";
import { redact } from "./privacy.ts";

const ref = z.string().regex(/^[0-9a-f]{64}$/);
const safeText = z
  .string()
  .trim()
  .min(1)
  .max(16000)
  .refine((v) => redact(v) === v, "Unsafe memory text");
const source = z.object({
  agent_id: z.enum(["pm", "tl"]),
  session_id: z.string(),
  entry_id: z.string(),
});
export const memoryRecordSchema = z
  .object({
    ref,
    revision: ref,
    content: safeText,
    scope: z
      .object({ global: z.boolean(), projects: z.array(z.string()) })
      .strict()
      .refine((s) => (s.global ? s.projects.length === 0 : s.projects.length > 0)),
    kind: z.string(),
    tags: z.array(z.string()),
    sources: z.array(source),
    active: z.literal(true),
  })
  .strip();
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
const common = {
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  source_refs: z.array(ref).min(1).max(100),
};
const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("insert"),
      content: safeText,
      kind: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("update"),
      ref,
      content: safeText,
      reason: safeText.max(1000),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("forget"),
      ref,
      reason: safeText.max(1000),
      replacement_id: z.string().optional(),
    })
    .strict(),
]);
export const dreamPlanSchema = z.object({ operations: z.array(operationSchema).max(100) }).strict();
export type DreamOperation = z.infer<typeof operationSchema>;
export const scopeKey = (record: MemoryRecord) =>
  record.scope.global ? "global" : [...record.scope.projects].sort().join(",");

export function validateDreamPlan(input: unknown, records: MemoryRecord[], recentRefs: string[]) {
  const plan = dreamPlanSchema.parse(input);
  const lookup = new Map(records.map((r) => [r.ref, r]));
  const seen = new Map<string, DreamOperation>();
  const targets = new Set<string>();
  for (const operation of plan.operations) {
    if (seen.has(operation.id)) throw new Error("Duplicate operation id");
    const evidence = operation.source_refs.map((r) => {
      const record = lookup.get(r);
      if (!record) throw new Error("Unknown citation");
      return record;
    });
    const scope = scopeKey(evidence[0]);
    if (evidence.some((r) => scopeKey(r) !== scope)) throw new Error("Cross-scope evidence");
    if (!operation.source_refs.some((r) => recentRefs.includes(r)))
      throw new Error("Operation needs recent evidence");
    if (operation.type !== "insert") {
      const target = lookup.get(operation.ref);
      if (!target || scopeKey(target) !== scope)
        throw new Error("Unknown target or scope conflict");
      if (targets.has(target.ref)) throw new Error("Repeated mutation target");
      targets.add(target.ref);
      if (operation.type === "forget" && operation.replacement_id) {
        const replacement = seen.get(operation.replacement_id);
        if (
          !replacement ||
          replacement.type === "forget" ||
          !replacement.source_refs.includes(target.ref) ||
          scopeKey(lookup.get(replacement.source_refs[0])!) !== scope
        )
          throw new Error("Merge requires an earlier same-scope replacement");
      }
    }
    seen.set(operation.id, operation);
  }
  return plan;
}

export function mutationRequest(operation: DreamOperation, records: MemoryRecord[], runId: string) {
  const evidence = records.filter((r) => operation.source_refs.includes(r.ref));
  const guards = evidence.map(({ ref, revision }) => ({ ref, revision }));
  const target =
    operation.type === "insert" ? undefined : records.find((r) => r.ref === operation.ref);
  const citedRecords = operation.type === "update" && target ? [target, ...evidence] : evidence;
  const sources = [
    ...new Map(citedRecords.flatMap((r) => r.sources).map((s) => [JSON.stringify(s), s])).values(),
  ];
  if (sources.length > 200) throw new Error("Too many source citations");
  if (operation.type === "insert") {
    return {
      name: "memory_remember",
      arguments: {
        content: operation.content,
        kind: operation.kind,
        scope: evidence[0].scope,
        sources,
        evidence: guards,
        idempotency_key: `dream:${runId}:${operation.id}`,
      },
    };
  }
  if (!target) throw new Error("Unknown mutation target");
  const args = { ref: target.ref, expected_revision: target.revision, evidence: guards };
  return operation.type === "update"
    ? {
        name: "memory_update",
        arguments: { ...args, content: operation.content, reason: operation.reason, sources },
      }
    : { name: "memory_forget", arguments: args };
}
