import { z } from "zod";
import { memoryMetadataSchema, memoryRefSchema, type MemoryRecord } from "./records.ts";
import { redact } from "./privacy.ts";
import type { CleanupArtifact } from "./dream-stages.ts";

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const text = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => redact(v) === v);
const kind = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
// Python str.strip() defines upstream identity, including whitespace JS trim omits.
const pythonWhitespace = (char: string) =>
  /\p{White_Space}/u.test(char) || (char.charCodeAt(0) >= 28 && char.charCodeAt(0) <= 31);
function normalizedContent(value: string) {
  let start = 0,
    end = value.length;
  while (start < end && pythonWhitespace(value[start])) start++;
  while (end > start && pythonWhitespace(value[end - 1])) end--;
  return value.slice(start, end).toLowerCase();
}
const metadata = z
  .object({
    knowledge_type: z.literal("fact"),
    confidence: memoryMetadataSchema.shape.confidence,
    keywords: memoryMetadataSchema.shape.keywords,
    mentioned_at: memoryMetadataSchema.shape.mentioned_at,
    expires_at: memoryMetadataSchema.shape.expires_at,
    rationale: memoryMetadataSchema.shape.rationale,
  })
  .strict();
const common = { id, summary: text };
const content = { content: text, kind, memory_metadata: metadata };
export const operationCleanupSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              ...common,
              ...content,
              type: z.literal("add"),
              source_refs: z.array(memoryRefSchema).min(1).max(100),
            })
            .strict(),
          z
            .object({ ...common, ...content, type: z.literal("replace"), ref: memoryRefSchema })
            .strict(),
          z
            .object({
              ...common,
              ...content,
              type: z.literal("merge"),
              refs: z.array(memoryRefSchema).min(2).max(20),
            })
            .strict(),
          z.object({ ...common, type: z.literal("retire"), ref: memoryRefSchema }).strict(),
        ]),
      )
      .max(20),
  })
  .strict();
export type OperationCleanup = z.infer<typeof operationCleanupSchema>;

export function operationSources(operation: OperationCleanup["operations"][number]): string[] {
  if (operation.type === "add") return operation.source_refs;
  return operation.type === "merge" ? operation.refs : [operation.ref];
}

export function validateOperationCleanup(
  input: unknown,
  inputs: MemoryRecord[],
  records: MemoryRecord[],
): OperationCleanup {
  const artifact = operationCleanupSchema.parse(input);
  const ids = new Set<string>();
  const targets = new Set<string>();
  const contents = new Set<string>();
  for (const operation of artifact.operations) {
    if (ids.has(operation.id)) throw new Error("Duplicate operation id");
    ids.add(operation.id);
    const refs = operationSources(operation);
    if (new Set(refs).size !== refs.length) throw new Error("Repeated dream source");
    if (operation.type === "add") {
      if (!refs.some((ref) => inputs.some((r) => r.ref === ref)))
        throw new Error("Addition needs a reviewed input");
    } else {
      for (const ref of refs) {
        if (!inputs.some((r) => r.ref === ref)) throw new Error("Unknown cleanup target");
        if (targets.has(ref)) throw new Error("Repeated mutation target");
        targets.add(ref);
      }
    }
    const sources = refs.map((ref) => records.find((r) => r.ref === ref));
    if (sources.some((r) => !r || !r.sources.length)) throw new Error("Unknown dream source");
    const scope = JSON.stringify([...sources[0]!.projects].sort());
    if (sources.some((r) => JSON.stringify([...r!.projects].sort()) !== scope))
      throw new Error("Cross-scope dream claim");
    if (new Set(sources.flatMap((r) => r!.sources).map((s) => JSON.stringify(s))).size > 200)
      throw new Error("Too many dream source citations");
    if (operation.type !== "retire") {
      const normalized = normalizedContent(operation.content);
      if (
        contents.has(normalized) ||
        records.some((r) => normalizedContent(r.content) === normalized)
      )
        throw new Error("Duplicate proposed content");
      contents.add(normalized);
      const confidence = { disputed: 0, tentative: 1, supported: 2, confirmed: 3 };
      if (
        sources.some(
          (r) =>
            confidence[operation.memory_metadata.confidence] >
            confidence[r?.memory_metadata?.confidence ?? "tentative"],
        )
      )
        throw new Error("Dreaming cannot fabricate confirmation");
    }
  }
  return artifact;
}

/** Code-owned review view; never ask the model to emit unchanged dispositions. */
export function cleanupReview(artifact: OperationCleanup, inputs: MemoryRecord[]): CleanupArtifact {
  return {
    dispositions: inputs.map((input) => {
      const operation = artifact.operations.find(
        (op) => op.type !== "add" && operationSources(op).includes(input.ref),
      );
      if (!operation)
        return { ref: input.ref, disposition: "retain", reason: "Reviewed unchanged." };
      if (operation.type === "retire")
        return { ref: input.ref, disposition: "retire", reason: operation.summary };
      return {
        ref: input.ref,
        disposition: operation.type === "merge" ? "merge" : "replace",
        replacement_id: operation.id,
        reason: operation.summary,
      };
    }),
    facts: artifact.operations.flatMap((op) =>
      op.type === "retire"
        ? []
        : [
            {
              id: op.id,
              content: op.content,
              kind: op.kind,
              source_refs: operationSources(op),
              memory_metadata: {
                ...op.memory_metadata,
                stage: "durable" as const,
                status: "active" as const,
                evidence: [],
              },
            },
          ],
    ),
  };
}
