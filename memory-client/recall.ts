import { z } from "zod";
import { eligibleRecords, memoryRecordSchema, type MemoryRecord } from "./records.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";
import { redact } from "./privacy.ts";
import { DreamDiagnosticError } from "./dream-errors.ts";

export interface PreparedRecall {
  status: "ready" | "partial" | "unavailable";
  context: string;
  validationEvidence: MemoryRecord[];
  currentRefs: string[];
  preparedAt: string;
}

const codeReasons: Record<string, string> = {
  backend_unavailable: "the memory backend is unavailable",
  embedding_limit: "the search text is too long for memory search",
  invalid_request: "the memory request was rejected",
  revision_conflict: "memory changed during the lookup",
  evidence_conflict: "memory evidence changed during the lookup",
  scope_conflict: "memory scope did not match its evidence",
  inactive_memory: "a cited memory is no longer active",
};

export function recallFailureReason(error: unknown): string {
  if (error instanceof DreamDiagnosticError)
    return codeReasons[error.diagnostic.code] ?? "the memory service reported an error";
  if (error instanceof z.ZodError)
    return error.issues.some((issue) => issue.path[0] === "context")
      ? "the memory context was too large or could not be shown safely"
      : "the memory service returned an unexpected response";
  if (error instanceof Error && error.message === "Memory evidence changed")
    return "a cited memory changed during the lookup";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return "the memory lookup timed out";
  if (error instanceof TypeError) return "the memory service is not reachable";
  return "an unexpected memory error occurred";
}

export function unavailableRecall(reason = "the memory lookup did not finish"): PreparedRecall {
  return {
    status: "unavailable",
    context: `Memory unavailable: ${reason}. Please let the human owner know.`,
    validationEvidence: [],
    currentRefs: [],
    preparedAt: new Date().toISOString(),
  };
}

const recallSchema = z.object({
  context: z.string().refine((v) => Buffer.byteLength(v) <= 2000 && redact(v) === v),
  validation_evidence: z.array(memoryRecordSchema),
  current_refs: z.array(z.string()).default([]),
  incomplete: z.boolean(),
});

export async function runRecall(
  query: string,
  options: { url: string; signal: AbortSignal },
): Promise<PreparedRecall> {
  try {
    const client = new MemoryMcpClient(options.url);
    const data = recallSchema.parse(
      await abortable(
        client.call("memory_recall", { semantic_query: query }, options.signal),
        options.signal,
      ),
    );
    const fresh = await Promise.all(
      data.validation_evidence.map(async (record) => {
        const current = memoryRecordSchema.parse(
          await abortable(
            client.call("memory_get", { ref: record.ref }, options.signal),
            options.signal,
          ),
        );
        if (current.revision !== record.revision) throw new Error("Memory evidence changed");
        return current;
      }),
    );
    const now = new Date();
    const eligible = new Set(eligibleRecords(fresh, now).map((r) => r.ref));
    if (data.current_refs.some((ref) => !eligible.has(ref)))
      return unavailableRecall("a cited memory is no longer eligible");
    options.signal.throwIfAborted();
    return {
      status: data.incomplete ? "partial" : "ready",
      context: data.context,
      validationEvidence: fresh,
      currentRefs: data.current_refs,
      preparedAt: now.toISOString(),
    };
  } catch (error) {
    return unavailableRecall(recallFailureReason(error));
  }
}
