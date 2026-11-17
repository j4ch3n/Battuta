import { z } from "zod";
import { eligibleRecords, memoryRecordSchema, type MemoryRecord } from "./records.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";
import { redact } from "./privacy.ts";
import { DreamDiagnosticError } from "./dream-errors.ts";

export interface PreparedRecall {
  status: "success" | "partial" | "failed";
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

export function failedRecall(reason = "the memory lookup did not finish"): PreparedRecall {
  return {
    status: "failed",
    context: failureMessage(reason),
    validationEvidence: [],
    currentRefs: [],
    preparedAt: new Date().toISOString(),
  };
}

function failureMessage(reason: string) {
  return `Memory unavailable: ${reason}. Please let the human owner know.`;
}

const MAX_ENTRY_BYTES = 4000;
const NO_ENTRIES = "no relevant memory found";

function entriesWithinBudget(context: string) {
  return context.split(/(?=^- )/m).every((entry) => Buffer.byteLength(entry) <= MAX_ENTRY_BYTES);
}

const recallSchema = z.object({
  status: z.enum(["success", "partial", "failed"]),
  context: z.string().refine((v) => entriesWithinBudget(v) && redact(v) === v),
  validation_evidence: z.array(memoryRecordSchema),
  current_refs: z.array(z.string()).default([]),
  omitted_refs: z.array(z.string()).default([]),
  branches: z.record(z.string(), z.string()).default({}),
});

export async function runRecall(
  messages: string[],
  options: { url: string; signal: AbortSignal; limit: number; maxDistance: number },
): Promise<PreparedRecall> {
  try {
    const client = new MemoryMcpClient(options.url);
    const data = recallSchema.parse(
      await abortable(
        client.call(
          "memory_recall",
          { semantic_queries: messages, limit: options.limit, max_distance: options.maxDistance },
          options.signal,
        ),
        options.signal,
      ),
    );
    if (data.status === "failed") {
      console.warn("Memory recall failed");
      return failedRecall();
    }
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
    if (data.current_refs.some((ref) => !eligible.has(ref))) {
      console.warn("Memory recall failed: a cited memory is no longer eligible");
      return failedRecall("a cited memory is no longer eligible");
    }
    options.signal.throwIfAborted();
    const failedBranches = Object.entries(data.branches)
      .filter(([, state]) => state === "failed")
      .map(([name]) => name);
    if (data.status === "partial") {
      console.warn(
        "Memory recall partial",
        JSON.stringify({ failedBranches, omittedRefs: data.omitted_refs }),
      );
    }
    const entries = data.context === NO_ENTRIES ? "" : data.context;
    const notices = [
      ...failedBranches.map((name) => `the ${name} memory search failed`),
      ...(data.omitted_refs.length
        ? [`memory entries could not be shown (${data.omitted_refs.join(", ")})`]
        : []),
    ];
    const context =
      data.status === "partial" ? `${entries}${failureMessage(notices.join("; "))}` : data.context;
    return {
      status: data.status,
      context,
      validationEvidence: fresh,
      currentRefs: data.current_refs,
      preparedAt: now.toISOString(),
    };
  } catch (error) {
    const reason = recallFailureReason(error);
    console.warn("Memory recall failed", reason);
    return failedRecall(reason);
  }
}
