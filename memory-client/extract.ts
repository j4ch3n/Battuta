import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { digest, type CaptureJob } from "./capture-queue.ts";
import { abortable } from "./abortable.ts";
import { memoryMetadataSchema, memoryRefSchema, type MemoryRecord } from "./records.ts";
import { redact } from "./privacy.ts";

const itemSchema = z
  .object({
    content: z.string().trim().min(1).max(1000),
    scope: z.object({ global: z.boolean(), projects: z.array(z.string()).default([]) }).strict(),
    kind: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,39}$/)
      .default("observation"),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(100)).max(100).default([]),
    source_entry_ids: z.array(z.string()).min(1).max(200),
    keywords: memoryMetadataSchema.shape.keywords.default([]),
    confidence: z.enum(["confirmed", "supported", "tentative", "disputed"]).default("confirmed"),
    expires_at: z.string().datetime({ offset: true }).nullable().default(null),
    correction: z.object({ ref: memoryRefSchema, revision: memoryRefSchema }).strict().optional(),
  })
  .strict();
const schema = z.object({ items: z.array(itemSchema).max(20) }).strict();

export async function extractMemories(
  job: CaptureJob,
  ctx: ExtensionContext,
  signal: AbortSignal,
  role: "cos" | "manager" = "cos",
  onUsage: (usage: unknown) => void = () => {},
  candidates: MemoryRecord[] = [],
) {
  signal.throwIfAborted();
  if (!ctx.model) throw new Error("No configured extraction model");
  const response = await abortable(
    ctx.modelRegistry.complete(
      ctx.model,
      {
        systemPrompt: await readFile(new URL("./prompts/capture.md", import.meta.url), "utf8"),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              project: job.segment.project,
              messages: job.segment.messages,
              correction_candidates: candidates,
              rephrase: job.rephraseAttempts
                ? "Previous extraction exceeded the embedding token limit. Split or shorten every fact to at most 100 words."
                : undefined,
            }),
            timestamp: Date.now(),
          },
        ],
      },
      { signal, maxTokens: 4096 },
    ),
    signal,
  );
  onUsage(response.usage);
  signal.throwIfAborted();
  if (response.stopReason !== "stop") throw new Error("Extraction did not finish");
  const parsed = schema.parse(
    JSON.parse(response.content.map((p) => (p.type === "text" ? p.text : "")).join("")),
  );
  const sourceIds = new Set(job.segment.messages.map((m) => m.entry_id));
  const items = parsed.items.map((item, i) => {
    if (redact(item.content) !== item.content) throw new Error("Unsafe extracted memory text");
    if (item.tags.some((t) => t.includes(",") || /^(scope|proj|kind):/.test(t)))
      throw new Error("Invalid extracted memory tag");
    const projects = [...new Set(item.scope.projects)].sort();
    if (
      item.scope.global
        ? projects.length !== 0
        : projects.length !== 1 || projects[0] !== job.segment.project
    )
      throw new Error("Extraction scope conflict");
    if (item.source_entry_ids.some((id) => !sourceIds.has(id)))
      throw new Error("Unknown source citation");
    const cited = job.segment.messages.filter((m) => item.source_entry_ids.includes(m.entry_id));
    if (cited.every((m) => m.speaker === "assistant"))
      throw new Error("Assistant text is not owner confirmation");
    if (item.expires_at && cited.some((m) => !m.mentioned_at || !m.source_timezone))
      throw new Error("Unknown source timezone cannot establish expiry");
    if (
      item.correction &&
      !candidates.some(
        (r) =>
          r.ref === item.correction?.ref &&
          r.revision === item.correction.revision &&
          r.scope.global === item.scope.global &&
          JSON.stringify(r.scope.projects) === JSON.stringify(projects),
      )
    )
      throw new Error("Unknown correction target");
    const memory_metadata = memoryMetadataSchema.parse({
      stage: "temporal",
      knowledge_type: "fact",
      confidence:
        cited.some((m) => !m.speaker) && item.confidence === "confirmed"
          ? "tentative"
          : item.confidence,
      status: "active",
      keywords: item.keywords,
      mentioned_at: cited[0]?.mentioned_at ?? null,
      expires_at: item.expires_at,
      rationale: null,
      evidence: [],
    });
    return {
      item_id: `${job.id}${job.rephraseAttempts ? ":rephrase" : ""}:${i}`,
      content: item.content,
      scope: { global: item.scope.global, projects },
      kind: item.kind,
      tags: [...new Set(item.tags)].sort(),
      memory_metadata,
      ...(item.correction ? { correction: item.correction } : {}),
      sources: [...new Set(item.source_entry_ids)].map((entry_id) => ({
        agent_id: role,
        session_id: job.session_id,
        entry_id,
        ...(cited.find((m) => m.entry_id === entry_id)?.speaker
          ? {
              attribution: {
                speaker: cited.find((m) => m.entry_id === entry_id)!.speaker,
                mentioned_at: cited.find((m) => m.entry_id === entry_id)!.mentioned_at ?? null,
                timezone: cited.find((m) => m.entry_id === entry_id)!.source_timezone ?? null,
                original_mail: cited.find((m) => m.entry_id === entry_id)!.original_mail ?? null,
              },
            }
          : {}),
      })),
      idempotency_key: null,
    };
  });
  const payload = {
    session_id: job.session_id,
    batch_id: job.id + (job.rephraseAttempts ? ":rephrase" : ""),
    agent_id: role,
    items,
  };
  return { batch: { ...payload, payload_digest: digest(payload) }, usage: response.usage };
}
