import { z } from "zod";
import { eligibleRecords, memoryRecordSchema, type MemoryRecord } from "./records.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";
import { redact } from "./privacy.ts";

export interface PreparedRecall {
  status: "ready" | "partial" | "unavailable";
  context: string;
  validationEvidence: MemoryRecord[];
  currentRefs: string[];
  preparedAt: string;
}

export function unavailableRecall(): PreparedRecall {
  return {
    status: "unavailable",
    context: "Memory unavailable; this is not an empty memory inventory.",
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
    if (data.current_refs.some((ref) => !eligible.has(ref))) return unavailableRecall();
    options.signal.throwIfAborted();
    return {
      status: data.incomplete ? "partial" : "ready",
      context: data.context,
      validationEvidence: fresh,
      currentRefs: data.current_refs,
      preparedAt: now.toISOString(),
    };
  } catch {
    return unavailableRecall();
  }
}
