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
  observeRecall(raw: unknown, isError: boolean) {
    this.attempt();
    this.observe(raw, isError);
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
      // Every parent preparation must observe a real MCP query. A child that declines to query
      // cannot turn a greeting or transport gap into an implicit empty-memory result.
      if (
        !this.attempts ||
        outcome.status === "skipped" ||
        !this.successes ||
        !outcome.context.trim()
      )
        return unavailableRecall();
      return {
        ...outcome,
        status: this.partial ? "partial" : outcome.status,
        validationEvidence: [...this.evidence.values()],
        currentRefs: [...this.currentRefs],
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
        pi.on("tool_call", (event) => {
          if (event.toolName === "mcp__memory__memory_recall") collector.attempt();
        });
        pi.on("tool_result", (event) => {
          if (event.toolName === "mcp__memory__memory_recall")
            collector.observe(event.structuredContent, event.isError);
        });
      },
    });
    // This is an isolated child's MCP tool, not a main-CoS connection. Await its outcome before
    // allowing the child model to prepare a packet, so a skipped/no-tool response cannot bypass
    // the required search. The child can still rewrite and enrich with later recall/get calls.
    const query = await abortable(
      child.queryRecall(
        input.current.trim() ||
          input.history.at(-1)?.text ||
          input.summary ||
          "recent owner context",
      ),
      options.signal,
    );
    // Preserve the MCP AgentTool result verbatim for the isolated child. It is untrusted evidence,
    // not a host-produced summary, and never enters the main CoS context except through the child's
    // validated packet below.
    collector.observeRecall(query.structuredContent, query.isError === true);
    if (query.isError) return unavailableRecall();
    child.session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant")
        options.onUsage(event.message.usage);
    });
    await abortable(
      child.session.prompt(
        JSON.stringify({
          ...input,
          required_query_result: query.structuredContent,
        }),
      ),
      options.signal,
    );
    const messages = child.session.messages;
    const last = messages.at(-1);
    if (last?.role !== "assistant" || last.stopReason !== "stop") return unavailableRecall();
    const result = collector.finish(child.session.getLastAssistantText() ?? "");
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
      const after = new Set(eligibleRecords(fresh, now).map((r) => r.ref));
      if (result.currentRefs.some((ref) => !after.has(ref))) return unavailableRecall();
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
