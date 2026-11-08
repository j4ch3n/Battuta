import { z } from "zod";
import { redact } from "./privacy.ts";

export const memoryRefSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const memoryProjectsSchema = z
  .array(z.string())
  .min(1)
  .max(100)
  .transform((projects) => [...new Set(projects)].sort())
  .refine((projects) => !projects.includes("global") || projects.length === 1);
const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((v) =>
    new Date(v)
      .toISOString()
      .replace(/\.(\d{3})Z$/, (_match, ms: string) => (ms === "000" ? "Z" : `.${ms}000Z`)),
  )
  .nullable()
  .optional();
export const memoryMetadataSchema = z
  .object({
    stage: z.enum(["temporal", "durable"]),
    knowledge_type: z.enum(["fact", "synthesized-observation", "hypothesis"]),
    confidence: z.enum(["confirmed", "supported", "tentative", "disputed"]),
    status: z.enum(["active", "stale", "superseded", "rejected"]),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((v) => !/\p{C}/u.test(v) && redact(v) === v),
      )
      .max(20)
      .default([])
      .refine((v) => new Set(v.map((k) => k.normalize("NFKC").toLowerCase())).size === v.length),
    mentioned_at: timestamp,
    expires_at: timestamp,
    rationale: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((v) => redact(v) === v)
      .nullable()
      .optional(),
    evidence: z
      .array(
        z
          .object({
            ref: memoryRefSchema,
            revision: memoryRefSchema,
            relation: z.enum(["supports", "contradicts"]),
            requirement: z.enum(["historical", "current"]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .refine(
    (m) =>
      m.knowledge_type === "fact" ||
      (m.confidence !== "confirmed" &&
        !!m.rationale &&
        m.evidence.some((e) => e.relation === "supports")),
    "Derived claim needs support and rationale",
  );
export type MemoryMetadata = z.infer<typeof memoryMetadataSchema>;

export const memoryRecordSchema = z
  .object({
    ref: memoryRefSchema,
    revision: memoryRefSchema,
    review_fingerprint: memoryRefSchema.optional(),
    metadata_error: z.literal(false).optional(),
    content: z
      .string()
      .trim()
      .min(1)
      .max(16000)
      .refine((v) => redact(v) === v, "Unsafe memory text"),
    scope: z
      .object({ global: z.boolean(), projects: z.array(z.string()) })
      .strict()
      .refine((s) => (s.global ? s.projects.length === 0 : s.projects.length > 0)),
    kind: z.string(),
    tags: z.array(z.string()),
    sources: z.array(
      z.object({
        agent_id: z.enum(["cos", "manager"]),
        session_id: z.string().min(1),
        entry_id: z.string().min(1),
        attribution: z
          .object({
            speaker: z.enum(["owner", "assistant", "agent"]),
            mentioned_at: z.string().datetime({ offset: true }).nullable(),
            timezone: z.string().nullable(),
            original_mail: z
              .object({
                message_ref: z.object({ conversation_id: z.string(), id: z.string() }),
                sender: z.string(),
              })
              .nullable(),
          })
          .optional(),
      }),
    ),
    active: z.literal(true),
    memory_metadata: memoryMetadataSchema.optional(),
  })
  .strip();
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export function inRequestScope(record: MemoryRecord, project: string | null) {
  return record.scope.global || (project !== null && record.scope.projects.includes(project));
}

export function eligibleRecords(records: MemoryRecord[], now: Date, includeExpired = false) {
  const lookup = new Map(records.map((r) => [r.ref, r]));
  const checked = new Map<string, boolean>();
  const valid = (ref: string, historical: boolean, visiting: Set<string>): boolean => {
    const key = `${ref}:${historical}`;
    const cached = checked.get(key);
    if (cached !== undefined) return cached;
    const r = lookup.get(ref);
    if (!r || !r.active || !r.sources.length || visiting.has(ref)) return false;
    const m = r.memory_metadata;
    if (
      m &&
      (m.status !== "active" ||
        (!historical && m.expires_at && now.getTime() >= Date.parse(m.expires_at)))
    )
      return false;
    const eligible = (m?.evidence ?? []).every((link) => {
      const support = lookup.get(link.ref);
      return (
        support?.revision === link.revision &&
        support.scope.global === r.scope.global &&
        JSON.stringify([...support.scope.projects].sort()) ===
          JSON.stringify([...r.scope.projects].sort()) &&
        valid(link.ref, link.requirement === "historical", new Set([...visiting, ref]))
      );
    });
    checked.set(key, eligible);
    return eligible;
  };
  return records.filter((r) => valid(r.ref, includeExpired, new Set()));
}
