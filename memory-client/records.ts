import { z } from "zod";
import { redact } from "./privacy.ts";

export const memoryRefSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime({ offset: true }).nullable().optional();
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
      }),
    ),
    active: z.literal(true),
    memory_metadata: memoryMetadataSchema.optional(),
  })
  .strip();
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
