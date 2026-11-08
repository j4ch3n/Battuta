import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CaptureJob } from "./capture-queue.ts";
import { capturePayloadDigest } from "./canonical.ts";
import { validateMemoryProjects, normalizedProjects } from "./projects.ts";
import { abortable } from "./abortable.ts";
import { memoryMetadataSchema, memoryRefSchema, type MemoryRecord } from "./records.ts";
import { redact } from "./privacy.ts";

const itemSchema = z
  .object({
    content: z.string().trim().min(1).max(1000),
    projects: z.unknown(),
    retry_entry_id: z.number().int().min(0).optional(),
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
  if (!job.project_catalog) throw new Error("Capture catalog unavailable");
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
              available_projects: job.project_catalog,
              rejected_entries: job.project_rejections?.map((rejection) => ({
                ...rejection,
                error: "Select projects only from available_projects",
                retry_entry_id: rejection.index,
              })),
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
  const project_rejections: NonNullable<CaptureJob["project_rejections"]> = [];
  const retried = new Set<number>();
  const items = parsed.items.flatMap((item, i) => {
    if (redact(item.content) !== item.content) throw new Error("Unsafe extracted memory text");
    if (item.tags.some((t) => t.includes(",") || /^(scope|proj|kind):/.test(t)))
      throw new Error("Invalid extracted memory tag");
    let index = i;
    if (job.project_rejections?.length) {
      const rejected = job.project_rejections.find((r) => r.index === item.retry_entry_id);
      if (
        !rejected ||
        retried.has(rejected.index) ||
        item.source_entry_ids.some(
          (id) => !(rejected.item.source_entry_ids as string[]).includes(id),
        )
      )
        throw new Error("Invalid project correction identity");
      index = rejected.index;
      retried.add(index);
    } else if (item.retry_entry_id !== undefined)
      throw new Error("Unexpected project correction identity");
    if (item.source_entry_ids.some((id) => !sourceIds.has(id)))
      throw new Error("Unknown source citation");
    const cited = job.segment.messages.filter((m) => item.source_entry_ids.includes(m.entry_id));
    if (cited.every((m) => m.speaker === "assistant"))
      throw new Error("Assistant text is not owner confirmation");
    if (item.expires_at && cited.some((m) => !m.mentioned_at || !m.source_timezone))
      throw new Error("Unknown source timezone cannot establish expiry");
    let projects: string[];
    try {
      projects = validateMemoryProjects(item.projects, job.project_catalog!);
    } catch {
      project_rejections.push({ index, item });
      return [];
    }
    if (
      item.correction &&
      !candidates.some(
        (r) =>
          r.ref === item.correction?.ref &&
          r.revision === item.correction.revision &&
          JSON.stringify(normalizedProjects(r.scope.global ? ["global"] : r.scope.projects)) ===
            JSON.stringify(normalizedProjects(projects)),
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
    return [
      {
        item_id: `${job.id}${job.projectAttempts ? `:projects:${job.projectAttempts}` : ""}${job.rephraseAttempts ? ":rephrase" : ""}:${index}`,
        content: item.content,
        projects,
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
      },
    ];
  });
  if (job.project_rejections?.length && retried.size !== job.project_rejections.length)
    throw new Error("Project correction omitted rejected entries");
  const payload = {
    session_id: job.session_id,
    batch_id:
      job.id +
      (job.projectAttempts ? `:projects:${job.projectAttempts}` : "") +
      (job.rephraseAttempts ? ":rephrase" : ""),
    agent_id: role,
    items,
  };
  return {
    batch: { ...payload, payload_digest: capturePayloadDigest(payload) },
    project_rejections,
    usage: response.usage,
  };
}
