import { z } from "zod";
import { digest } from "./canonical.ts";
import {
  memoryMetadataSchema,
  memoryRecordSchema,
  memoryRefSchema as ref,
  type MemoryRecord,
} from "./records.ts";
import { redact } from "./privacy.ts";

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const text = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => redact(v) === v, "Unsafe dream text");
const proposedClaim = z
  .object({
    id,
    content: text,
    kind: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    source_refs: z.array(ref).min(1).max(100),
    memory_metadata: memoryMetadataSchema,
  })
  .strict();
export const cleanupArtifactSchema = z
  .object({
    dispositions: z
      .array(
        z
          .object({
            ref,
            disposition: z.enum(["retain", "replace", "merge", "defer"]),
            reason: text,
            replacement_id: id.optional(),
            memory_metadata: memoryMetadataSchema.optional(),
          })
          .strict(),
      )
      .max(20),
    facts: z.array(proposedClaim).max(20),
  })
  .strict();
export const synthesisArtifactSchema = z
  .object({
    proposals: z
      .array(
        proposedClaim.extend({
          cleanup_evidence: z
            .array(
              z
                .object({
                  id,
                  relation: z.enum(["supports", "contradicts"]),
                  requirement: z.enum(["historical", "current"]),
                })
                .strict(),
            )
            .max(20)
            .default([]),
        }),
      )
      .max(10),
  })
  .strict();
export const challengeArtifactSchema = z
  .object({
    decisions: z
      .array(
        z.object({ id, verdict: z.enum(["accept", "reject", "defer"]), reason: text }).strict(),
      )
      .max(10),
  })
  .strict();
export type CleanupArtifact = z.infer<typeof cleanupArtifactSchema>;
export type SynthesisArtifact = z.infer<typeof synthesisArtifactSchema>;
export type ChallengeArtifact = z.infer<typeof challengeArtifactSchema>;

export function recordFingerprint(record: MemoryRecord, records: MemoryRecord[]) {
  if (record.review_fingerprint) return record.review_fingerprint;
  const meaningful = (r: MemoryRecord) => {
    const metadata = r.memory_metadata ? { ...r.memory_metadata } : undefined;
    if (metadata) delete (metadata as Partial<typeof metadata>).stage;
    return {
      content: r.content,
      scope: r.scope,
      sources: r.sources,
      kind: r.kind,
      tags: r.tags,
      metadata,
    };
  };
  return digest({
    claim: meaningful(record),
    evidence:
      record.memory_metadata?.evidence.map((e) => ({
        link: e,
        state: records.find((r) => r.ref === e.ref)
          ? meaningful(records.find((r) => r.ref === e.ref)!)
          : null,
      })) ?? [],
  });
}

export function selectUnprocessed(records: unknown[], reviewed: Record<string, string>) {
  const valid: MemoryRecord[] = [];
  const deferred: { ref: string; reason: string }[] = [];
  for (const raw of records) {
    const parsed = memoryRecordSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.sources.length) {
      const candidate = z.object({ ref }).safeParse(raw);
      if (candidate.success)
        deferred.push({
          ref: candidate.data.ref,
          reason: "Missing or invalid scope, attribution or lifecycle metadata",
        });
      else throw new Error("Inventory record lacks a stable ref");
    } else if (!parsed.data.memory_metadata || parsed.data.memory_metadata.status === "active")
      valid.push(parsed.data);
  }
  return {
    pending: valid.filter(
      (r) =>
        !r.memory_metadata ||
        r.memory_metadata.stage === "temporal" ||
        reviewed[r.ref] !== recordFingerprint(r, valid) ||
        r.memory_metadata.evidence.some(
          (e) => !valid.some((source) => source.ref === e.ref && source.revision === e.revision),
        ),
    ),
    deferred,
  };
}

const scopeKey = (r: MemoryRecord) =>
  JSON.stringify({ global: r.scope.global, projects: [...r.scope.projects].sort() });

function validateClaim(
  claim: z.infer<typeof proposedClaim>,
  records: MemoryRecord[],
  derived: boolean,
) {
  const sources = claim.source_refs.map((ref) => records.find((r) => r.ref === ref));
  if (
    sources.some((r) => !r || !r.sources.length) ||
    new Set(claim.source_refs).size !== claim.source_refs.length
  )
    throw new Error("Unknown or repeated dream source");
  const source = sources[0]!;
  if (new Set(sources.flatMap((r) => r!.sources).map((s) => JSON.stringify(s))).size > 200)
    throw new Error("Too many dream source citations");
  if (sources.some((r) => scopeKey(r!) !== scopeKey(source)))
    throw new Error("Cross-scope dream claim");
  const metadata = claim.memory_metadata;
  if ((metadata.knowledge_type !== "fact") !== derived)
    throw new Error("Wrong dream knowledge type");
  if (metadata.status !== "active") throw new Error("New proposals start active until challenge");
  if (
    metadata.confidence === "confirmed" &&
    sources.some((r) => r?.memory_metadata?.confidence !== "confirmed")
  )
    throw new Error("Dreaming cannot fabricate confirmation");
  for (const link of metadata.evidence) {
    const evidence = records.find((r) => r.ref === link.ref);
    if (!evidence || evidence.revision !== link.revision || scopeKey(evidence) !== scopeKey(source))
      throw new Error("Invalid dream evidence");
    if (!claim.source_refs.includes(link.ref)) throw new Error("Evidence lacks source coverage");
  }
  if (records.some((r) => r.content.trim().toLowerCase() === claim.content.trim().toLowerCase()))
    throw new Error("Use retain for unchanged content; do not resurrect a rejected interpretation");
  return source;
}

export function validateCleanup(input: unknown, inputs: MemoryRecord[], records: MemoryRecord[]) {
  const artifact = cleanupArtifactSchema.parse(input);
  if (
    artifact.dispositions.length !== inputs.length ||
    new Set(artifact.dispositions.map((d) => d.ref)).size !== inputs.length ||
    artifact.dispositions.some((d) => !inputs.some((r) => r.ref === d.ref))
  )
    throw new Error("Every pending input needs exactly one disposition");
  if (
    new Set(artifact.facts.map((f) => f.id)).size !== artifact.facts.length ||
    new Set(artifact.facts.map((f) => f.content.trim().toLowerCase())).size !==
      artifact.facts.length
  )
    throw new Error("Duplicate cleanup fact");
  for (const fact of artifact.facts) {
    validateClaim(fact, records, false);
    if (!artifact.dispositions.some((d) => d.replacement_id === fact.id))
      throw new Error("Unreferenced cleanup output");
  }
  const retiring = new Set(
    artifact.dispositions
      .filter((d) => d.disposition === "replace" || d.disposition === "merge")
      .map((d) => d.ref),
  );
  for (const fact of artifact.facts)
    if (fact.memory_metadata.evidence.some((e) => retiring.has(e.ref)))
      throw new Error("Replacement cannot depend on retired evidence");
  for (const disposition of artifact.dispositions) {
    const original = inputs.find((r) => r.ref === disposition.ref)!;
    if (disposition.disposition === "replace" || disposition.disposition === "merge") {
      const replacement = artifact.facts.find((f) => f.id === disposition.replacement_id);
      if (!replacement?.source_refs.includes(original.ref))
        throw new Error("Replacement must preserve source coverage");
    } else if (disposition.replacement_id) throw new Error("Unexpected replacement");
    if (disposition.memory_metadata) {
      const m = disposition.memory_metadata;
      if (
        m.confidence !== (original.memory_metadata?.confidence ?? "tentative") ||
        m.knowledge_type !== (original.memory_metadata?.knowledge_type ?? "fact") ||
        m.status !== "active"
      )
        throw new Error("Review cannot change confidence, knowledge type or status");
      for (const link of m.evidence)
        if (
          !records.some(
            (r) =>
              r.ref === link.ref &&
              r.revision === link.revision &&
              scopeKey(r) === scopeKey(original),
          )
        )
          throw new Error("Invalid retained evidence");
    }
  }
  return artifact;
}

export function validateSynthesis(
  input: unknown,
  cleanup: CleanupArtifact,
  inputs: MemoryRecord[],
  records: MemoryRecord[],
) {
  const artifact = synthesisArtifactSchema.parse(input);
  if (
    new Set([...cleanup.facts, ...artifact.proposals].map((p) => p.content.trim().toLowerCase()))
      .size !==
    cleanup.facts.length + artifact.proposals.length
  )
    throw new Error("Duplicate proposed content");
  if (new Set(artifact.proposals.map((p) => p.id)).size !== artifact.proposals.length)
    throw new Error("Duplicate synthesis id");
  for (const claim of artifact.proposals) {
    validateClaim(claim, records, true);
    if (!claim.source_refs.some((ref) => inputs.some((r) => r.ref === ref)))
      throw new Error("Synthesis needs a reviewed input");
    if (
      claim.source_refs.some((ref) =>
        cleanup.dispositions.some((d) => d.ref === ref && d.disposition === "defer"),
      )
    )
      throw new Error("Synthesis cannot settle deferred evidence");
    for (const link of claim.cleanup_evidence)
      if (
        !cleanup.facts.some(
          (f) => f.id === link.id && f.source_refs.some((ref) => claim.source_refs.includes(ref)),
        )
      )
        throw new Error("Unknown cleanup evidence");
    for (const link of claim.memory_metadata.evidence) {
      const retirement = cleanup.dispositions.find(
        (d) => d.ref === link.ref && (d.disposition === "replace" || d.disposition === "merge"),
      );
      if (
        retirement &&
        !claim.cleanup_evidence.some(
          (e) =>
            e.id === retirement.replacement_id &&
            e.relation === link.relation &&
            e.requirement === link.requirement,
        )
      )
        throw new Error("Synthesis must explicitly cite the reviewed replacement content");
    }
  }
  return artifact;
}

export function validateChallenge(input: unknown, synthesis: SynthesisArtifact) {
  const artifact = challengeArtifactSchema.parse(input);
  if (
    artifact.decisions.length !== synthesis.proposals.length ||
    new Set(artifact.decisions.map((d) => d.id)).size !== synthesis.proposals.length ||
    artifact.decisions.some((d) => !synthesis.proposals.some((p) => p.id === d.id))
  )
    throw new Error("Every synthesis needs an explicit challenge verdict");
  return artifact;
}
