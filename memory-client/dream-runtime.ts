import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { acquireDreamLock, atomicPrivateWrite, optionalText } from "./dream-files.ts";
import {
  createDreamReflection,
  publishDreamLog,
  type DreamComplete,
  type DreamOutcome,
} from "./dream-result.ts";
import { redact } from "./privacy.ts";
import { eligibleRecords, memoryMetadataSchema, memoryRecordSchema } from "./records.ts";
import type { MemoryRecord } from "./records.ts";
import { digest } from "./canonical.ts";
import { DREAM_HOUR, DREAM_MINUTE } from "./dream-schedule.ts";
import { DreamDiagnosticError, dreamDiagnostic, type DreamDiagnostic } from "./dream-errors.ts";

export interface DreamDependencies {
  directory: string;
  now: () => Date;
  complete: DreamComplete;
  call: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    catalog?: readonly string[],
  ) => Promise<unknown>;
  prepareProjects?: (signal: AbortSignal) => Promise<string[]>;
  onStage?: (stage: string) => void;
}

const ref = z.string().regex(/^[0-9a-f]{64}$/);
const MAX_INVENTORY = 2000;
const CUE_BATCH = 20;
const MAX_CUE_TARGETS = 200;
const CONFIDENCE = ["disputed", "tentative", "supported", "confirmed"];

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => redact(v) === v);
const insertSchema = z
  .object({
    content: safeText(1000),
    keywords: memoryMetadataSchema.shape.keywords,
    confidence: memoryMetadataSchema.shape.confidence,
    expires_at: memoryMetadataSchema.shape.expires_at,
  })
  .strict();
const editOutputSchema = z
  .object({
    keep: z.array(z.number().int()).default([]),
    remove: z.array(z.number().int()).default([]),
    insert: z.array(insertSchema).max(20).default([]),
    summary: safeText(1000),
  })
  .strict();
const editSchema = z.object({
  keep: z.array(ref),
  remove: z.array(ref),
  insert: z.array(insertSchema),
  summary: safeText(1000),
});
const hypothesesOutputSchema = z
  .object({
    hypotheses: z
      .array(
        z
          .object({
            content: safeText(1000),
            keywords: insertSchema.shape.keywords,
            rationale: safeText(1000),
            clusters: z.array(z.number().int()).min(1).max(50),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
const checkpointSchema = z.object({
  version: z.literal(5),
  run_id: z.string().datetime(),
  completed: z.boolean(),
  records: z.array(memoryRecordSchema),
  expired: z.array(ref),
  removed: z.array(ref),
  clusters: z
    .array(z.object({ key: z.string(), project: z.string(), refs: z.array(ref) }))
    .optional(),
  edits: z.record(z.string(), editSchema),
  done: z.record(
    z.string(),
    z.object({
      kept: z.array(ref),
      removed: z.array(ref),
      inserted: z.array(ref),
      summary: z.string(),
    }),
  ),
  failed: z.array(z.string()),
  hypotheses: hypothesesOutputSchema.shape.hypotheses.optional(),
  hypotheses_published: z.number().int().optional(),
  reviewed: z.record(z.string(), z.string()),
  summaries: z.record(z.string(), z.string()),
  reflection: z.string().optional(),
  summary: z.string().optional(),
  conflict: z.boolean().optional(),
  error: z
    .object({
      stage: z.string(),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
      paths: z.array(z.string()).optional(),
    })
    .optional(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;
type Edit = z.infer<typeof editSchema>;

export function dreamRunId(now: Date): string {
  const due = new Date(now);
  due.setHours(DREAM_HOUR, DREAM_MINUTE, 0, 0);
  if (due > now) due.setDate(due.getDate() - 1);
  return due.toISOString();
}

function evidenceJson(value: unknown) {
  const text = redact(JSON.stringify(value));
  if (Buffer.byteLength(text) > 200000)
    throw new Error("Dream evidence exceeds model input budget");
  return text;
}

const maxConfidence = (records: MemoryRecord[]) =>
  Math.max(...records.map((r) => CONFIDENCE.indexOf(r.memory_metadata?.confidence ?? "tentative")));

// `members` is the numbered list shown to the model (1-based); the model never sees refs.
export function validateEdit(value: unknown, members: MemoryRecord[], all: MemoryRecord[]): Edit {
  const output = editOutputSchema.parse(value);
  const numbers = [...output.keep, ...output.remove];
  if (numbers.some((n) => n < 1 || n > members.length)) throw new Error("Invalid memory number");
  if (new Set(numbers).size !== numbers.length) throw new Error("Repeated memory number");
  const existing = new Set(all.map((r) => r.content.trim()));
  const proposed = output.insert.map((i) => i.content);
  if (new Set(proposed).size !== proposed.length || proposed.some((c) => existing.has(c)))
    throw new Error("Duplicate proposed content");
  const ceiling = maxConfidence(members);
  if (output.insert.some((i) => CONFIDENCE.indexOf(i.confidence) > ceiling))
    throw new Error("Dreaming cannot fabricate confirmation");
  const removed = new Set(output.remove);
  return {
    keep: members.filter((_, i) => !removed.has(i + 1)).map((r) => r.ref),
    remove: output.remove.map((n) => members[n - 1].ref),
    insert: output.insert,
    summary: output.summary,
  };
}

const cuesOutputSchema = z
  .object({
    memories: z.array(
      z
        .object({
          n: z.number().int(),
          cues: z
            .array(
              z
                .object({
                  angle: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
                  text: safeText(1000),
                })
                .strict(),
            )
            .max(100),
        })
        .strict(),
    ),
  })
  .strict();

export function validateCues(value: unknown, memberCount: number) {
  const output = cuesOutputSchema.parse(value);
  const numbers = output.memories.map((m) => m.n);
  if (numbers.some((n) => n < 1 || n > memberCount)) throw new Error("Invalid memory number");
  if (new Set(numbers).size !== numbers.length) throw new Error("Repeated memory number");
  return output.memories;
}

export function validateHypotheses(value: unknown, clusterCount: number) {
  const output = hypothesesOutputSchema.parse(value);
  const contents = output.hypotheses.map((h) => h.content);
  if (new Set(contents).size !== contents.length) throw new Error("Duplicate proposed content");
  if (output.hypotheses.some((h) => h.clusters.some((n) => n < 1 || n > clusterCount)))
    throw new Error("Unknown cluster number");
  return output.hypotheses;
}

async function structured<T>(
  deps: DreamDependencies,
  promptFile: string,
  stage: string,
  evidence: unknown,
  validate: (value: unknown) => T,
  signal: AbortSignal,
) {
  const prompt = await readFile(new URL(`./prompts/${promptFile}`, import.meta.url), "utf8");
  let diagnostic: DreamDiagnostic | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const response = await deps.complete(
      prompt +
        (attempt
          ? `\nPrevious structured output was invalid. Correct it under the same schema. Validation feedback (data): ${JSON.stringify(diagnostic)}`
          : ""),
      evidenceJson(evidence),
      signal,
    );
    try {
      return validate(JSON.parse(response) as unknown);
    } catch (error) {
      diagnostic = dreamDiagnostic(error, stage);
      if (attempt) throw new DreamDiagnosticError(diagnostic);
    }
  }
  throw new Error("Dream artifact unavailable");
}

const modelView = (r: MemoryRecord, n: number) => ({
  n,
  content: r.content,
  kind: r.kind,
  knowledge_type: r.memory_metadata?.knowledge_type ?? "fact",
  confidence: r.memory_metadata?.confidence ?? "tentative",
  keywords: r.memory_metadata?.keywords ?? [],
  mentioned_at: r.memory_metadata?.mentioned_at ?? null,
  expires_at: r.memory_metadata?.expires_at ?? null,
  ...(r.memory_metadata?.rationale ? { rationale: r.memory_metadata.rationale } : {}),
});

const unique = <T>(items: T[]) => [...new Map(items.map((i) => [JSON.stringify(i), i])).values()];

export async function runDream(
  deps: DreamDependencies,
  signal: AbortSignal,
): Promise<DreamOutcome> {
  deps.onStage?.("checkpoint");
  signal.throwIfAborted();
  const path = join(deps.directory, "dream-state.json");
  const release = await acquireDreamLock(deps.directory);
  try {
    const raw = await optionalText(path);
    const parsed = raw ? checkpointSchema.safeParse(JSON.parse(raw)) : undefined;
    const previous = parsed?.success ? parsed.data : undefined;
    const runId = dreamRunId(deps.now());
    const outcome = (s: Checkpoint): DreamOutcome =>
      s.failed.length || s.conflict
        ? { status: "partial", ...(s.error ? { error: s.error } : {}) }
        : { status: "complete", summary: s.summary ?? "Memory review completed." };
    if (previous?.completed && previous.run_id === runId) return outcome(previous);

    const state: Checkpoint =
      previous && !previous.completed && previous.run_id === runId
        ? previous
        : {
            version: 5,
            run_id: runId,
            completed: false,
            records: [],
            expired: [],
            removed: [],
            edits: {},
            done: {},
            failed: [],
            reviewed: previous?.reviewed ?? {},
            summaries: previous?.summaries ?? {},
          };
    const save = () => atomicPrivateWrite(path, JSON.stringify(state));
    const log = (line: string) =>
      appendFile(join(deps.directory, "dream.log"), `step ${deps.now().toISOString()} ${line}\n`, {
        mode: 0o600,
      });
    const inventory = async () => {
      const data = z
        .object({ records: z.array(z.unknown()).max(MAX_INVENTORY) })
        .parse(await deps.call("memory_inventory", { max_records: MAX_INVENTORY }, signal));
      return data.records.flatMap((item) => {
        const r = memoryRecordSchema.safeParse(item);
        return r.success ? [r.data] : [];
      });
    };
    let catalog: string[] | undefined;
    const remember = async (args: Record<string, unknown>) => {
      catalog ??= await deps.prepareProjects?.(signal);
      if (!catalog) throw new Error("Dream project catalog unavailable");
      const result = z
        .object({ ref })
        .parse(await deps.call("memory_remember", args, signal, catalog));
      return memoryRecordSchema.parse(await deps.call("memory_get", { ref: result.ref }, signal));
    };
    const live = (refs: string[]) => {
      const gone = new Set(state.removed);
      const lookup = new Map(state.records.map((r) => [r.ref, r]));
      return refs.filter((r) => !gone.has(r) && lookup.has(r)).map((r) => lookup.get(r)!);
    };
    const retire = async (r: MemoryRecord) => {
      await deps.call("memory_forget", { ref: r.ref, expected_revision: r.revision }, signal);
      if (!state.removed.includes(r.ref)) state.removed.push(r.ref);
    };
    const fail = async (error: unknown, stage: string, key: string) => {
      if (!(error instanceof DreamDiagnosticError) || signal.aborted) throw error;
      state.error = { ...error.diagnostic, stage };
      if (error.diagnostic.retryable === false) state.conflict = true;
      if (!state.failed.includes(key)) state.failed.push(key);
      await save();
    };

    deps.onStage?.("inventory");
    if (!state.clusters) {
      const records = await inventory();
      state.records = records;
      const projects = new Set(records.flatMap((r) => r.projects));
      await log(
        `inventory projects=${projects.size} records=${records.length} new=${records.filter((r) => state.reviewed[r.ref] !== r.revision).length}`,
      );
      deps.onStage?.("expire");
      const now = deps.now().getTime();
      for (const r of records) {
        const at = r.memory_metadata?.expires_at;
        if (at && now >= Date.parse(at)) {
          await retire(r);
          state.expired.push(r.ref);
        }
      }
      state.records = live(records.map((r) => r.ref));
      state.removed = [];
      await log(`expire deleted=${state.expired.length}`);
      deps.onStage?.("cluster");
      const response = z
        .object({
          projects: z.array(
            z.object({
              project: z.string(),
              clusters: z.array(z.array(ref)),
              singletons: z.number(),
              largest: z.number(),
              raised: z.array(z.object({ from: z.number(), to: z.number() })),
            }),
          ),
        })
        .parse(await deps.call("memory_cluster", {}, signal));
      state.clusters = response.projects.flatMap((p) =>
        p.clusters.map((refs) => ({
          key: digest({ project: p.project, refs: [...refs].sort() }),
          project: p.project,
          refs,
        })),
      );
      for (const p of response.projects) {
        const raised = p.raised.length
          ? ` raised=${p.raised[0].from}->${p.raised[p.raised.length - 1].to}`
          : "";
        await log(
          `cluster project=${p.project} clusters=${p.clusters.length} singletons=${p.singletons} largest=${p.largest}${raised}`,
        );
      }
      await save();
    }

    const clusters = state.clusters;
    deps.onStage?.("edit");
    let inserted = 0;
    for (const cluster of clusters) {
      if (state.done[cluster.key] || state.failed.includes(cluster.key)) continue;
      const members = live(cluster.refs);
      const stale = members.some((r) => state.reviewed[r.ref] !== r.revision);
      if (members.length < 2 || (!stale && state.summaries[cluster.key])) continue;
      try {
        state.edits[cluster.key] ??= await structured(
          deps,
          "dream-edit.md",
          "edit",
          { project: cluster.project, memories: members.map((r, i) => modelView(r, i + 1)) },
          (value) => validateEdit(value, members, state.records),
          signal,
        );
        await save();
        const edit = state.edits[cluster.key];
        const lookup = new Map(state.records.map((r) => [r.ref, r]));
        const removed = edit.remove.map((r) => lookup.get(r)!);
        const basis = removed.length ? removed : members;
        // shortcut: truncates attribution past 200 sources; upgrade if clusters of 30 can exceed it
        const sources = unique(basis.flatMap((r) => r.sources)).slice(0, 200);
        const newRefs: string[] = [];
        for (const [i, item] of edit.insert.entries()) {
          const record = await remember({
            content: item.content,
            kind: removed[0]?.kind ?? "observation",
            projects: removed.length
              ? [...new Set(removed.flatMap((r) => r.projects))].sort()
              : [cluster.project],
            sources,
            evidence: basis.map(({ ref: r, revision }) => ({ ref: r, revision })),
            idempotency_key: `dream:${state.run_id}:${cluster.key.slice(0, 16)}:${i}`,
            memory_metadata: memoryMetadataSchema.parse({
              knowledge_type: "fact",
              confidence: item.confidence,
              keywords: item.keywords,
              mentioned_at:
                basis
                  .map((r) => r.memory_metadata?.mentioned_at)
                  .filter((v): v is string => !!v)
                  .sort()
                  .pop() ?? null,
              expires_at: item.expires_at,
              rationale: null,
              evidence: [],
            }),
          });
          if (!lookup.has(record.ref)) state.records.push(record);
          newRefs.push(record.ref);
        }
        for (const r of removed) await retire(r);
        state.done[cluster.key] = {
          kept: edit.keep,
          removed: edit.remove,
          inserted: newRefs,
          summary: edit.summary,
        };
        for (const r of live(edit.keep)) state.reviewed[r.ref] = r.revision;
        state.summaries[cluster.key] = edit.summary;
        inserted += newRefs.length;
        await log(
          `edit cluster=${cluster.key.slice(0, 8)} size=${members.length} keep=${edit.keep.length} remove=${edit.remove.length} insert=${edit.insert.length}`,
        );
        await save();
      } catch (error) {
        await fail(error, "edit", cluster.key);
      }
    }
    await log(`publish inserted=${inserted} retired=${state.removed.length}`);

    deps.onStage?.("hypothesize");
    const members = (c: (typeof clusters)[number]) =>
      live([...c.refs, ...(state.done[c.key]?.inserted ?? [])]);
    const summarized = clusters.filter((c) => state.summaries[c.key] && members(c).length);
    if (!state.hypotheses && summarized.length) {
      try {
        state.hypotheses = await structured(
          deps,
          "dream-hypothesize.md",
          "hypothesize",
          {
            clusters: summarized.map((c, i) => ({
              n: i + 1,
              projects: c.project,
              summary: state.summaries[c.key],
            })),
          },
          (value) => validateHypotheses(value, summarized.length),
          signal,
        );
        await save();
      } catch (error) {
        await fail(error, "hypothesize", "hypothesize");
      }
    }
    let generated = 0;
    for (const [i, h] of (state.hypotheses ?? []).entries()) {
      if (i < (state.hypotheses_published ?? 0)) continue;
      try {
        const cited = [
          ...new Map(
            h.clusters.flatMap((n) => members(summarized[n - 1])).map((r) => [r.ref, r]),
          ).values(),
        ].slice(0, 100);
        if (cited.length) {
          await remember({
            content: h.content,
            kind: "hypothesis",
            projects: [...new Set(cited.flatMap((r) => r.projects))].sort(),
            sources: unique(cited.flatMap((r) => r.sources)).slice(0, 200),
            idempotency_key: `dream:${state.run_id}:h${i}`,
            memory_metadata: memoryMetadataSchema.parse({
              knowledge_type: "inference",
              confidence: "tentative",
              keywords: h.keywords,
              mentioned_at: null,
              expires_at: null,
              rationale: h.rationale,
              evidence: cited.map((r) => ({
                ref: r.ref,
                revision: r.revision,
                relation: "supports",
                requirement: "current",
              })),
            }),
          });
          generated++;
        }
        state.hypotheses_published = i + 1;
        await save();
      } catch (error) {
        // A rejected hypothesis (e.g. duplicate content) must not block the rest.
        if (!(error instanceof Error) || signal.aborted) throw error;
        state.hypotheses_published = i + 1;
        await log(`hypothesize skipped=${error.message.slice(0, 80)}`);
      }
    }
    await log(`hypothesize clusters=${summarized.length} generated=${generated}`);

    deps.onStage?.("cues");
    // Progress lives in the service (memories without cues), so only this run's attempts are tracked.
    const attempted = new Set<string>();
    let cueMemories = 0;
    let cuesWritten = 0;
    for (;;) {
      const data = z
        .object({ records: z.array(z.unknown()) })
        .parse(
          await deps.call(
            "memory_cue_targets",
            { limit: Math.min(MAX_CUE_TARGETS, CUE_BATCH + attempted.size) },
            signal,
          ),
        );
      const targets = data.records
        .flatMap((item) => {
          const r = memoryRecordSchema.safeParse(item);
          return r.success && !attempted.has(r.data.ref) ? [r.data] : [];
        })
        .slice(0, CUE_BATCH);
      if (!targets.length) break;
      for (const r of targets) attempted.add(r.ref);
      try {
        const cued = await structured(
          deps,
          "dream-cues.md",
          "cues",
          { cue_memories: targets.map((r, i) => modelView(r, i + 1)) },
          (value) => validateCues(value, targets.length),
          signal,
        );
        for (const { n, cues } of cued) {
          const target = targets[n - 1];
          try {
            await deps.call(
              "memory_set_cues",
              { ref: target.ref, expected_revision: target.revision, cues },
              signal,
            );
            cueMemories++;
            cuesWritten += cues.length;
          } catch (error) {
            // A memory that changed or fails alone must not block the rest; it is retried next run.
            if (!(error instanceof Error) || signal.aborted) throw error;
            await log(`cues skipped=${error.message.slice(0, 80)}`);
          }
        }
      } catch (error) {
        await fail(error, "cues", `cues:${targets[0].ref.slice(0, 8)}`);
      }
    }
    await log(`cues memories=${cueMemories} written=${cuesWritten}`);

    deps.onStage?.("refresh");
    const current = await inventory();
    await atomicPrivateWrite(
      join(deps.directory, "dream-profile.json"),
      JSON.stringify({
        claims: eligibleRecords(current, deps.now())
          .filter((r) => r.projects.includes("global"))
          .slice(0, 50)
          .map((r) => ({
            text: r.content,
            evidence: [{ ref: r.ref, revision: r.revision }],
            knowledge_type: r.memory_metadata?.knowledge_type ?? "fact",
            confidence: r.memory_metadata?.confidence ?? "tentative",
          })),
      }),
    );
    const keys = new Set(clusters.map((c) => c.key));
    state.summaries = Object.fromEntries(
      Object.entries(state.summaries).filter(([key]) => keys.has(key)),
    );
    state.summary =
      Object.values(state.done)
        .map((d) => d.summary)
        .join(" ") || "No memory changes were needed.";
    if (state.conflict) state.summary += " Some operations stopped on conflicting evidence.";
    if (!state.reflection) {
      deps.onStage?.("reflection");
      state.reflection = await createDreamReflection(
        deps.complete,
        state.run_id,
        {
          confirmed_changes: Object.values(state.done).map((d) => ({
            summary: d.summary,
            removed: d.removed.length,
            inserted: d.inserted.length,
          })),
          expired: state.expired.length,
          hypotheses: generated,
          failed_clusters: state.failed.length,
          partial: state.failed.length > 0 || !!state.conflict,
          profile_published: true,
          owner_file_unchanged: true,
        },
        signal,
      );
      await save();
    }
    signal.throwIfAborted();
    deps.onStage?.("dream_log");
    await publishDreamLog(deps.directory, state.run_id, state.reflection);
    state.completed = true;
    await save();
    return outcome(state);
  } finally {
    release();
  }
}
