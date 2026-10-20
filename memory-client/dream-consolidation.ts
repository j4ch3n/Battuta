import { z } from "zod";
import type { DreamDependencies } from "./dream-runtime.ts";
import type { MemoryRecord } from "./dream-mutations.ts";

const ref = z.string().regex(/^[0-9a-f]{64}$/);
const identity = {
  generation_id: ref,
  input_fingerprint: ref,
  algorithm_fingerprint: ref,
};
export const consolidationReceiptSchema = z.object({
  ...identity,
  status: z.literal("published"),
  input_count: z.number().int().min(0).max(500),
  cluster_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
});
export type ConsolidationReceipt = z.infer<typeof consolidationReceiptSchema>;
const edgeSchema = z.object({
  source_ref: ref,
  source_revision: ref,
  target_ref: ref,
  target_revision: ref,
  similarity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  relationship_type: z.string().regex(/^[a-z_]{1,40}$/),
  needs_review: z.boolean(),
});
export const globalRelationshipsSchema = z.discriminatedUnion("status", [
  z.object({
    ...identity,
    status: z.literal("current"),
    edges: z.array(edgeSchema).max(100),
    truncated: z.boolean(),
  }),
  z.object({
    generation_id: ref.nullable(),
    input_fingerprint: ref.nullable(),
    algorithm_fingerprint: ref.nullable(),
    status: z.enum(["stale", "unavailable"]),
    edges: z.array(edgeSchema).length(0),
    truncated: z.literal(false),
  }),
]);

export async function readGlobalHints(
  call: DreamDependencies["call"],
  records: MemoryRecord[],
  signal: AbortSignal,
): Promise<unknown[]> {
  signal.throwIfAborted();
  try {
    const result = globalRelationshipsSchema.parse(
      await call("memory_global_relationships", {}, signal),
    );
    signal.throwIfAborted();
    if (result.status !== "current") return [];
    const revisions = new Map(
      records.filter((r) => r.scope.global).map((r) => [r.ref, r.revision]),
    );
    return result.edges.filter(
      (edge) =>
        edge.source_ref !== edge.target_ref &&
        revisions.get(edge.source_ref) === edge.source_revision &&
        revisions.get(edge.target_ref) === edge.target_revision,
    );
  } catch {
    // Derived context is optional, cancellation is not.
    signal.throwIfAborted();
    return [];
  }
}

export async function ensureGlobalConsolidation(
  call: DreamDependencies["call"],
  runId: string,
  prior: ConsolidationReceipt | undefined,
  signal: AbortSignal,
): Promise<ConsolidationReceipt> {
  signal.throwIfAborted();
  if (prior) {
    const current = globalRelationshipsSchema.parse(
      await call("memory_global_relationships", {}, signal),
    );
    signal.throwIfAborted();
    if (
      current.status === "current" &&
      current.generation_id === prior.generation_id &&
      current.input_fingerprint === prior.input_fingerprint &&
      current.algorithm_fingerprint === prior.algorithm_fingerprint
    )
      return prior;
  }
  const result = consolidationReceiptSchema.parse(
    await call("memory_consolidate_global", { run_id: runId }, signal),
  );
  signal.throwIfAborted();
  return result;
}
