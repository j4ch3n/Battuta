import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RecallInput } from "./recall-context.ts";
import { createRecallSession } from "./recall-session.ts";
import { eligibleRecords, memoryRecordSchema, type MemoryRecord } from "./records.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";
import { redact } from "./privacy.ts";

const outcomeSchema = z
  .object({
    status: z.enum(["skipped", "ready", "partial", "unavailable"]),
    context: z.string().refine((v) => Buffer.byteLength(v) <= 2000 && redact(v) === v),
  })
  .strict();
export type RecallOutcome = z.infer<typeof outcomeSchema>;
export interface PreparedRecall extends RecallOutcome {
  validationEvidence: MemoryRecord[];
  preparedAt: string;
}
export function unavailableRecall(): PreparedRecall {
  return {
    status: "unavailable",
    context: "Memory unavailable; this is not an empty memory inventory.",
    validationEvidence: [],
    preparedAt: new Date().toISOString(),
  };
}

export class RecallCollector {
  private attempts = 0;
  private successes = 0;
  private partial = false;
  private evidence = new Map<string, MemoryRecord>();
  private changed = false;
  private currentRefs = new Set<string>();
  attempt() {
    this.attempts++;
  }
  observe(raw: unknown, isError: boolean) {
    const parsed = z
      .object({
        structuredContent: z.object({
          ok: z.literal(true),
          data: z.object({
            validation_evidence: z.array(memoryRecordSchema),
            incomplete: z.boolean(),
            current_refs: z.array(z.string()).default([]),
          }),
        }),
      })
      .safeParse(raw);
    if (isError || !parsed.success) {
      this.partial = true;
      return;
    }
    this.successes++;
    this.partial ||= parsed.data.structuredContent.data.incomplete;
    for (const ref of parsed.data.structuredContent.data.current_refs) this.currentRefs.add(ref);
    for (const record of parsed.data.structuredContent.data.validation_evidence) {
      const prior = this.evidence.get(record.ref);
      if (prior && prior.revision !== record.revision) this.changed = true;
      this.evidence.set(record.ref, record);
    }
  }
  finish(text: string): PreparedRecall {
    try {
      const outcome = outcomeSchema.parse(JSON.parse(text));
      if (outcome.status === "unavailable" || this.changed) return unavailableRecall();
      const eligible = new Set(
        eligibleRecords([...this.evidence.values()], new Date()).map((r) => r.ref),
      );
      if ([...this.currentRefs].some((ref) => !eligible.has(ref))) return unavailableRecall();
      if (outcome.status === "skipped") {
        if (this.attempts || outcome.context) return unavailableRecall();
      } else if (!this.successes || !outcome.context.trim()) return unavailableRecall();
      return {
        ...outcome,
        status: this.partial ? "partial" : outcome.status,
        validationEvidence: [...this.evidence.values()],
        preparedAt: new Date().toISOString(),
      };
    } catch {
      return unavailableRecall();
    }
  }
}

export async function runRecallAgent(
  input: RecallInput,
  ctx: ExtensionContext,
  options: {
    url: string;
    signal: AbortSignal;
    capturePending: boolean;
    onUsage: (usage: unknown) => void;
  },
): Promise<PreparedRecall> {
  const collector = new RecallCollector();
  let child: Awaited<ReturnType<typeof createRecallSession>> | undefined;
  try {
    child = await createRecallSession(ctx, {
      ...options,
      systemPrompt: await readFile(new URL("./prompts/recall.md", import.meta.url), "utf8"),
      observe: (pi) => {
        pi.on("tool_call", () => {
          collector.attempt();
          if (options.capturePending)
            return {
              block: true,
              reason: "Memory unavailable: earlier capture may contain corrections.",
            };
        });
        pi.on("tool_result", (event) => collector.observe(event.structuredContent, event.isError));
      },
    });
    child.session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant")
        options.onUsage(event.message.usage);
    });
    await abortable(
      child.session.prompt(
        JSON.stringify({
          ...input,
          ...(options.capturePending
            ? {
                memory_availability:
                  "capture-pending; skip if unnecessary, otherwise return unavailable",
              }
            : {}),
        }),
      ),
      options.signal,
    );
    const messages = child.session.messages;
    const last = messages.at(-1);
    if (last?.role !== "assistant" || last.stopReason !== "stop") return unavailableRecall();
    const result = collector.finish(child.session.getLastAssistantText() ?? "");
    if (options.capturePending && result.status !== "skipped") return unavailableRecall();
    if (result.status === "ready" || result.status === "partial") {
      const client = new MemoryMcpClient(options.url);
      const fresh = await Promise.all(
        result.validationEvidence.map(async (record) => {
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
      const before = new Set(
        eligibleRecords(result.validationEvidence, new Date(result.preparedAt)).map((r) => r.ref),
      );
      const after = new Set(eligibleRecords(fresh, now).map((r) => r.ref));
      if ([...before].some((ref) => !after.has(ref))) return unavailableRecall();
      result.validationEvidence = fresh;
      result.preparedAt = now.toISOString();
    }
    options.signal.throwIfAborted();
    return result;
  } catch {
    return unavailableRecall();
  } finally {
    await child?.dispose();
  }
}
