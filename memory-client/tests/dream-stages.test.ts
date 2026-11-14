import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { selectUnprocessed, validateCleanup } from "../dream-stages.ts";
import { validateOperationCleanup } from "../dream-cleanup.ts";
import { runDream, type DreamDependencies } from "../dream-runtime.ts";
import { record } from "./fixtures/record.ts";
import { digest } from "../capture-queue.ts";
import { memoryMetadataSchema, memoryRecordSchema, type MemoryRecord } from "../records.ts";

test.each(["hypothesis", "synthesized-observation"] as const)(
  "retired %s can clear evidence without allowing unsupported active claims",
  (knowledge_type) => {
    const retired = {
      ...record().memory_metadata!,
      status: "superseded" as const,
      knowledge_type,
      confidence: "tentative" as const,
      rationale: "Supported before retirement",
      evidence: [],
    };
    expect(memoryMetadataSchema.safeParse(retired).success).toBe(true);
    expect(memoryMetadataSchema.safeParse({ ...retired, status: "active" }).success).toBe(false);
  },
);

const dirs: string[] = [];
function factMetadata(record: MemoryRecord) {
  const m = record.memory_metadata!;
  return {
    knowledge_type: m.knowledge_type,
    confidence: m.confidence,
    keywords: m.keywords,
    mentioned_at: m.mentioned_at,
    expires_at: m.expires_at,
    rationale: m.rationale,
  };
}
test("cleanup accepts an empty operation list and rejects deferral", () => {
  const input = record();
  expect(validateOperationCleanup({ operations: [] }, [input], [input])).toEqual({
    operations: [],
  });
  expect(() =>
    validateOperationCleanup({ operations: [], deferred_refs: [input.ref] }, [input], [input]),
  ).toThrow();
});

test("cleanup accepts a standalone replacement without lifecycle dependencies", () => {
  const input = record();
  const memory_metadata = factMetadata(input);
  const proposal = {
    operations: [
      {
        id: "rewrite",
        type: "replace",
        ref: input.ref,
        content: "Reworded attributed fact",
        kind: "observation",
        memory_metadata,
        summary: "Reworded the fact.",
      },
    ],
  };
  expect(validateOperationCleanup(proposal, [input], [input])).toEqual(proposal);
});

test("cleanup rejects replacements colliding under Python whitespace normalization", () => {
  const input = record();
  expect(() =>
    validateOperationCleanup(
      {
        operations: [
          {
            id: "collision",
            type: "replace",
            ref: input.ref,
            content: "\u0085" + input.content,
            kind: input.kind,
            summary: "Reworded.",
            memory_metadata: factMetadata(input),
          },
        ],
      },
      [input],
      [input],
    ),
  ).toThrow();
});

test("retirement cannot target an acknowledged replacement with the same ref", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete,
    call = f.deps.call;
  f.deps.complete = (prompt, evidence, signal) =>
    prompt.includes("Stage: cleanup")
      ? Promise.resolve(
          JSON.stringify({
            operations: [
              {
                id: "rewrite",
                type: "replace",
                ref: original.ref,
                content: "Different proposed wording",
                kind: "event",
                summary: "Reworded.",
                memory_metadata: factMetadata(original),
              },
            ],
          }),
        )
      : complete(prompt, evidence, signal);
  f.deps.call = (name, args, signal, catalog) =>
    name === "memory_remember"
      ? Promise.resolve({ ref: original.ref, revision: original.revision })
      : call(name, args, signal, catalog);
  await runDream(f.deps, new AbortController().signal);
  expect(f.records.has(original.ref)).toBe(true);
  expect(f.writes).toEqual([]);
});

test("cleanup validates operation scopes, target uniqueness, and evidence-free metadata", () => {
  const a = record(),
    b = record("b".repeat(64));
  const memory_metadata = factMetadata(a);
  const fact = { content: "Combined facts", kind: "observation", memory_metadata };
  const merge = { id: "combine", type: "merge", refs: [a.ref, b.ref], summary: "Merged.", ...fact };
  const add = { id: "add", type: "add", source_refs: [a.ref], summary: "Added.", ...fact };
  const retire = { id: "retire", type: "retire", ref: a.ref, summary: "Retired." };
  for (const operation of [merge, add, retire])
    expect(
      validateOperationCleanup({ operations: [operation] }, [a, b], [a, b]).operations,
    ).toHaveLength(1);
  for (const operations of [
    [{ ...merge, refs: [a.ref] }],
    [retire, { ...retire, id: "second" }],
    [merge, { ...add, id: "combine" }],
    [{ ...add, memory_metadata: { ...memory_metadata, evidence: [] } }],
    [{ ...merge, refs: [a.ref, "c".repeat(64)] }],
  ])
    expect(() => validateOperationCleanup({ operations }, [a, b], [a, b])).toThrow();
  const other = { ...b, projects: ["other"] };
  expect(() => validateOperationCleanup({ operations: [merge] }, [a, other], [a, other])).toThrow();
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test.each(["unknown-source", "cross-scope", "confidence-boost", "stale-evidence"])(
  "cleanup rejects %s before publication",
  (failure) => {
    const a = record(),
      b = { ...record("b".repeat(64)), projects: ["atlas"] };
    if (failure === "confidence-boost") a.memory_metadata!.confidence = "tentative";
    const fact = {
      id: "replacement",
      content: "Consolidated supported detail",
      kind: "event",
      source_refs:
        failure === "unknown-source"
          ? ["d".repeat(64)]
          : failure === "cross-scope"
            ? [a.ref, b.ref]
            : [a.ref],
      memory_metadata: {
        ...a.memory_metadata!,
        confidence: "confirmed",
        ...(failure === "stale-evidence"
          ? {
              evidence: [
                {
                  ref: a.ref,
                  revision: "d".repeat(64),
                  relation: "supports",
                  requirement: "historical",
                },
              ],
            }
          : {}),
      },
    };
    expect(() =>
      validateCleanup(
        {
          dispositions: [
            {
              ref: a.ref,
              disposition: "replace",
              replacement_id: "replacement",
              reason: "Consolidated attributed detail",
            },
          ],
          facts: [fact],
        },
        [a],
        [a, b],
      ),
    ).toThrow();
  },
);

test.each(["missing", "temporal", "changed-durable"])(
  "old %s records stay pending independent of recent_refs",
  (stage) => {
    const r = { ...record(), created_at: 1, updated_at: 1, review_fingerprint: "b".repeat(64) };
    if (stage === "missing") delete r.memory_metadata;
    if (stage === "changed-durable") r.memory_metadata!.stage = "durable";
    expect(selectUnprocessed([r], { [r.ref]: "c".repeat(64) }).pending.map((r) => r.ref)).toEqual([
      r.ref,
    ]);
  },
);

test("a stale dependency revision remains pending even when review-only promotion leaves meaningful fingerprints unchanged", () => {
  const source = {
    ...record("b".repeat(64)),
    revision: "c".repeat(64),
    review_fingerprint: "d".repeat(64),
  };
  source.memory_metadata!.stage = "durable";
  const claim = {
    ...record(),
    review_fingerprint: "e".repeat(64),
    memory_metadata: {
      ...record().memory_metadata!,
      stage: "durable" as const,
      evidence: [
        {
          ref: source.ref,
          revision: "f".repeat(64),
          relation: "supports" as const,
          requirement: "historical" as const,
        },
      ],
    },
  };
  expect(
    selectUnprocessed([source, claim], {
      [source.ref]: source.review_fingerprint,
      [claim.ref]: claim.review_fingerprint,
    }).pending.map((r) => r.ref),
  ).toEqual([claim.ref]);
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dream-stages-"));
  dirs.push(directory);
  const r = { ...record(), review_fingerprint: "b".repeat(64) };
  const records = new Map<string, MemoryRecord & { review_fingerprint: string }>([[r.ref, r]]);
  const receipts = new Map<string, unknown>();
  const calls: string[] = [];
  const writes: string[] = [];
  let loseAck = false;
  const deps: DreamDependencies = {
    prepareProjects: () => Promise.resolve(["atlas", "beacon", "global"]),
    directory,
    now: () => new Date("2026-11-06T04:00:00Z"),
    complete: (prompt) => {
      if (prompt.includes("Stage: cleanup")) {
        calls.push("cleanup");
        return Promise.resolve('{"operations":[]}');
      }
      if (prompt.includes("Stage: synthesis")) {
        calls.push("synthesis");
        return Promise.resolve('{"proposals":[]}');
      }
      if (prompt.includes("Stage: challenge")) {
        calls.push("challenge");
        return Promise.resolve('{"decisions":[]}');
      }
      calls.push("reflection");
      return Promise.resolve("I reviewed the attributed fact without changing its confidence.");
    },
    call: (name, args) => {
      if (name === "memory_inventory")
        return Promise.resolve({
          records: [
            ...records.values(),
            { ref: "d".repeat(64), content: "Old unsupported record", active: true },
          ],
          inactive: [],
          recent_refs: [],
          window_start: args.window_start,
          window_end: args.window_end,
        });
      if (name === "memory_recall") return Promise.resolve({ records: [] });
      if (name === "memory_get") return Promise.resolve(records.get(String(args.ref)));
      if (name === "memory_remember") {
        const key = String(args.idempotency_key);
        if (receipts.has(key)) return Promise.resolve(receipts.get(key));
        const ref = digest(args.content);
        const created = memoryRecordSchema.parse({
          ref,
          revision: digest(args),
          content: args.content,
          projects: args.projects,
          kind: args.kind,
          tags: [],
          sources: args.sources,
          memory_metadata: args.memory_metadata,
          active: true,
          review_fingerprint: digest(args),
        });
        records.set(ref, { ...created, review_fingerprint: created.review_fingerprint! });
        writes.push(key);
        const receipt = { ref, revision: created.revision, before: null, after: created.content };
        receipts.set(key, receipt);
        return Promise.resolve(receipt);
      }
      if (name === "memory_set_metadata") {
        const key = String(args.idempotency_key);
        if (receipts.has(key)) return Promise.resolve(receipts.get(key));
        const current = records.get(String(args.ref))!;
        if (current.revision !== args.expected_revision)
          return Promise.reject(Object.assign(new Error("conflict"), { retryable: false }));
        const next = {
          ...current,
          memory_metadata: args.memory_metadata as MemoryRecord["memory_metadata"],
          revision: digest(args),
        };
        if (next.memory_metadata?.status === "superseded") records.delete(current.ref);
        else records.set(current.ref, next);
        writes.push(key);
        const receipt = {
          ref: current.ref,
          revision: next.revision,
          before: current.content,
          after: current.content,
        };
        receipts.set(key, receipt);
        if (loseAck) {
          loseAck = false;
          return Promise.reject(new Error("lost ack"));
        }
        return Promise.resolve(receipt);
      }
      return Promise.reject(new Error(`Unexpected operation ${name}`));
    },
  };
  return {
    deps,
    records,
    calls,
    writes,
    loseNextAck: () => {
      loseAck = true;
    },
  };
}

test("a valid empty cleanup reviews selected inputs without content changes", async () => {
  const f = await fixture();
  const complete = f.deps.complete;
  f.deps.complete = (prompt, evidence, signal) =>
    prompt.includes("Stage: cleanup")
      ? Promise.resolve('{"operations":[]}')
      : complete(prompt, evidence, signal);
  const original = [...f.records.values()][0];
  await runDream(f.deps, new AbortController().signal);
  expect(f.records.get(original.ref)?.content).toBe(original.content);
  expect(f.records.get(original.ref)?.memory_metadata?.stage).toBe("durable");
});

test.each(["add", "replace", "merge", "retire"] as const)(
  "%s publishes standalone facts and dependency-free retirement",
  async (type) => {
    const f = await fixture();
    const first = [...f.records.values()][0];
    const second = {
      ...record("b".repeat(64)),
      content: "Another source",
      sources: [{ ...first.sources[0], entry_id: "second-entry" }],
      review_fingerprint: "c".repeat(64),
    };
    f.records.set(second.ref, second);
    const operation = {
      id: "change",
      type,
      summary: "Applied change.",
      ...(type === "merge"
        ? { refs: [first.ref, second.ref] }
        : type === "add"
          ? { source_refs: [first.ref] }
          : { ref: first.ref }),
      ...(type === "retire"
        ? {}
        : { content: "New standalone fact", kind: "event", memory_metadata: factMetadata(first) }),
    };
    const complete = f.deps.complete;
    const call = f.deps.call;
    const retirements: Record<string, unknown>[] = [];
    f.deps.call = (name, args, signal, catalog) => {
      if (
        name === "memory_set_metadata" &&
        (args.memory_metadata as { status: string }).status === "superseded"
      )
        retirements.push(args);
      return call(name, args, signal, catalog);
    };
    f.deps.complete = (prompt, evidence, signal) =>
      prompt.includes("Stage: cleanup")
        ? Promise.resolve(JSON.stringify({ operations: [operation] }))
        : complete(prompt, evidence, signal);
    await runDream(f.deps, new AbortController().signal);
    expect(retirements).toHaveLength(type === "add" ? 0 : type === "merge" ? 2 : 1);
    for (const args of retirements) {
      expect(args.memory_metadata).toMatchObject({ status: "superseded", evidence: [] });
      expect(args).not.toHaveProperty("replacement_ref");
    }
    const created = [...f.records.values()].find((r) => r.content === "New standalone fact");
    if (type === "retire") expect(created).toBeUndefined();
    else {
      expect(created?.memory_metadata?.evidence).toEqual([]);
      expect(created?.sources).toHaveLength(type === "merge" ? 2 : first.sources.length);
    }
    const state = JSON.parse(
      await readFile(join(f.deps.directory, "dream-state.json"), "utf8"),
    ) as {
      artifacts: { cleanup: unknown };
      summary: string;
    };
    expect(state.artifacts.cleanup).toEqual({ operations: [operation] });
    expect(state.summary).toBe("Applied change.");
  },
);

test("version-three unpublished checkpoint is rebuilt without losing review receipts", async () => {
  const f = await fixture();
  await runDream(f.deps, new AbortController().signal);
  const path = join(f.deps.directory, "dream-state.json");
  const state = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    schema_version: number;
    prompt_version: number;
    completed: boolean;
    artifacts: Record<string, unknown>;
    requests: Record<string, unknown>;
    results: unknown[];
    legacy_receipts: unknown[];
    reviewed: Record<string, string>;
  };
  state.version = 3;
  state.schema_version = 1;
  state.prompt_version = 1;
  state.completed = false;
  state.artifacts = {};
  state.requests = {};
  state.results = [];
  state.legacy_receipts = [{ ref: "e".repeat(64) }];
  await writeFile(path, JSON.stringify(state));
  await runDream(f.deps, new AbortController().signal);
  const after = JSON.parse(await readFile(path, "utf8")) as typeof state;
  expect(after.version).toBe(4);
  expect(after.reviewed).toEqual(state.reviewed);
  expect(after.legacy_receipts).toEqual(state.legacy_receipts);
});

test("version-three frozen request replays unchanged rather than regenerating cleanup", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  f.loseNextAck();
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow("lost ack");
  const path = join(f.deps.directory, "dream-state.json");
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  state.version = 3;
  state.schema_version = 1;
  state.prompt_version = 1;
  state.artifacts = {
    cleanup: {
      dispositions: [{ ref: original.ref, disposition: "retain", reason: "Reviewed unchanged." }],
      facts: [],
    },
    synthesis: { proposals: [] },
    challenge: { decisions: [] },
  };
  const frozen = state.requests;
  await writeFile(path, JSON.stringify(state));
  await runDream(f.deps, new AbortController().signal);
  const after = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  expect(after.requests).toEqual(frozen);
  expect(f.writes).toHaveLength(1);
  expect(f.calls.filter((v) => v === "cleanup")).toHaveLength(1);
});

test("a failed replacement creation cannot retire its original", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete,
    call = f.deps.call;
  f.deps.complete = (prompt, evidence, signal) =>
    prompt.includes("Stage: cleanup")
      ? Promise.resolve(
          JSON.stringify({
            operations: [
              {
                id: "rewrite",
                type: "replace",
                ref: original.ref,
                content: "Rewritten fact",
                kind: "event",
                summary: "Reworded.",
                memory_metadata: factMetadata(original),
              },
            ],
          }),
        )
      : complete(prompt, evidence, signal);
  f.deps.call = (name, args, signal, catalog) =>
    name === "memory_remember"
      ? Promise.reject(new Error("creation unavailable"))
      : call(name, args, signal, catalog);
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow(
    "creation unavailable",
  );
  expect(f.records.has(original.ref)).toBe(true);
  expect(f.writes).toEqual([]);
});

test("a lost retirement acknowledgement replays its frozen request only once", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete;
  let cleanups = 0;
  f.deps.complete = (prompt, evidence, signal) => {
    if (prompt.includes("Stage: cleanup")) {
      cleanups++;
      return Promise.resolve(
        JSON.stringify({
          operations: [
            { id: "retire", type: "retire", ref: original.ref, summary: "Retired obsolete fact." },
          ],
        }),
      );
    }
    return complete(prompt, evidence, signal);
  };
  f.loseNextAck();
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow("lost ack");
  expect(f.records.has(original.ref)).toBe(false);
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes).toHaveLength(1);
  expect(cleanups).toBe(1);
});

test("withdrawal of a saved replacement before retirement preserves its original", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete,
    call = f.deps.call;
  let interrupt = true;
  f.deps.complete = (prompt, evidence, signal) =>
    prompt.includes("Stage: cleanup")
      ? Promise.resolve(
          JSON.stringify({
            operations: [
              {
                id: "rewrite",
                type: "replace",
                ref: original.ref,
                content: "New wording",
                kind: "event",
                summary: "Reworded.",
                memory_metadata: factMetadata(original),
              },
            ],
          }),
        )
      : complete(prompt, evidence, signal);
  f.deps.call = (name, args, signal, catalog) =>
    name === "memory_get" && args.ref !== original.ref && interrupt
      ? Promise.reject(new Error("interrupted before retirement"))
      : call(name, args, signal, catalog);
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow(
    "interrupted before retirement",
  );
  for (const r of f.records.values()) if (r.ref !== original.ref) f.records.delete(r.ref);
  interrupt = false;
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow();
  expect(f.records.has(original.ref)).toBe(true);
  expect(f.writes).toHaveLength(1);
});

test("cleanup retry receives a safe validation cause and exhausted output publishes nothing", async () => {
  const f = await fixture();
  const complete = f.deps.complete;
  const feedback: string[] = [];
  f.deps.complete = (prompt, evidence, signal) => {
    if (prompt.includes("Stage: cleanup")) {
      feedback.push(prompt);
      return Promise.resolve('{"operations":[{"type":"retire","ref":"private-invalid-value"}]}');
    }
    return complete(prompt, evidence, signal);
  };
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toMatchObject({
    diagnostic: { stage: "cleanup", code: "invalid_artifact" },
  });
  expect(feedback).toHaveLength(2);
  expect(feedback[1]).toContain("invalid_artifact");
  expect(feedback[1]).not.toContain("private-invalid-value");
  expect(f.writes).toEqual([]);
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    artifacts: unknown;
  };
  expect(state.artifacts).toEqual({});
});

test("unchanged claims with withdrawn support stay untouched and do not create a revisit queue", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  original.memory_metadata = {
    ...original.memory_metadata!,
    knowledge_type: "hypothesis",
    confidence: "tentative",
    rationale: "Previously supported",
    evidence: [
      {
        ref: "e".repeat(64),
        revision: "f".repeat(64),
        relation: "supports",
        requirement: "current",
      },
    ],
  };
  const call = f.deps.call;
  f.deps.call = (name, args, signal, catalog) => {
    if (name === "memory_get" && args.ref === original.ref)
      return Promise.reject(
        new Error("Withdrawn support must not be revalidated for unchanged claims"),
      );
    return call(name, args, signal, catalog);
  };
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes).toEqual([]);
  expect(f.records.get(original.ref)?.memory_metadata?.stage).toBe("temporal");
  const cleanupCalls = f.calls.filter((v) => v === "cleanup").length;
  f.deps.now = () => new Date("2026-11-07T04:00:00Z");
  await runDream(f.deps, new AbortController().signal);
  expect(f.calls.filter((v) => v === "cleanup")).toHaveLength(cleanupCalls);
});

test("three enforced stages review old input while preserving malformed pending evidence and private owner text", async () => {
  const f = await fixture();
  await writeFile(join(f.deps.directory, "ME.md"), "Private untracked owner writing");
  const outcome = await runDream(f.deps, new AbortController().signal);
  expect(f.calls).toEqual(["cleanup", "synthesis", "challenge", "reflection"]);
  expect(outcome.status).toBe("partial");
  expect(f.records.values().next().value?.memory_metadata).toMatchObject({
    stage: "durable",
    confidence: "confirmed",
  });
  expect(await readFile(join(f.deps.directory, "ME.md"), "utf8")).toBe(
    "Private untracked owner writing",
  );
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    version: number;
    pending: { ref: string }[];
  };
  expect(state.version).toBe(4);
  expect(state.pending.map((p) => p.ref)).toContain("d".repeat(64));
});

test("consolidated facts precede challenged claims and retirement; dependencies use explicitly reviewed replacement content", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete;
  f.deps.complete = (prompt, evidence, signal) => {
    if (prompt.includes("Stage: cleanup"))
      return Promise.resolve(
        JSON.stringify({
          operations: [
            {
              id: "purchase",
              type: "replace",
              ref: original.ref,
              summary: "Clarified supported console name",
              content: "Owner reported buying a Nintendo Switch 2",
              kind: "event",
              memory_metadata: factMetadata(original),
            },
          ],
        }),
      );
    if (prompt.includes("Stage: synthesis"))
      return Promise.resolve(
        JSON.stringify({
          proposals: [
            {
              id: "interest",
              content: "Owner may be interested in console games",
              kind: "observation",
              source_refs: [original.ref],
              cleanup_evidence: [
                { id: "purchase", relation: "supports", requirement: "historical" },
              ],
              memory_metadata: {
                ...original.memory_metadata,
                knowledge_type: "hypothesis",
                confidence: "tentative",
                rationale: "A possible interest, not an enduring trait",
                evidence: [
                  {
                    ref: original.ref,
                    revision: original.revision,
                    relation: "supports",
                    requirement: "historical",
                  },
                ],
              },
            },
          ],
        }),
      );
    if (prompt.includes("Stage: challenge"))
      return Promise.resolve(
        '{"decisions":[{"id":"interest","verdict":"accept","reason":"Appropriately tentative; no enduring preference inferred"}]}',
      );
    return complete(prompt, evidence, signal);
  };
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes.map((id) => id.split(":").slice(-2, -1)[0])).toEqual([
    "fact",
    "synthesis",
    "retire",
  ]);
  const hypothesis = [...f.records.values()].find(
    (r) => r.memory_metadata?.knowledge_type === "hypothesis",
  )!;
  const replacement = [...f.records.values()].find((r) => r.kind === "event")!;
  expect(hypothesis.memory_metadata?.evidence).toEqual([
    {
      ref: replacement.ref,
      revision: replacement.revision,
      relation: "supports",
      requirement: "historical",
    },
  ]);
  expect(hypothesis.memory_metadata?.confidence).toBe("tentative");
  expect(f.records.has(original.ref)).toBe(false);
});

test("unselected work stays in the next bounded batch without model deferral", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete;
  f.deps.complete = (prompt, evidence, signal) => {
    const input = JSON.parse(evidence) as {
      inputs?: MemoryRecord[];
      synthesis?: { proposals: unknown[] };
    };
    if (prompt.includes("Stage: synthesis") && input.inputs?.some((r) => r.ref === original.ref))
      return Promise.resolve(
        JSON.stringify({
          proposals: [
            {
              id: "uncertain",
              content: "A possible console interest",
              kind: "observation",
              source_refs: [original.ref],
              memory_metadata: {
                ...original.memory_metadata,
                knowledge_type: "hypothesis",
                confidence: "tentative",
                rationale: "Needs clarification",
                evidence: [
                  {
                    ref: original.ref,
                    revision: original.revision,
                    relation: "supports",
                    requirement: "historical",
                  },
                ],
              },
            },
          ],
        }),
      );
    if (prompt.includes("Stage: challenge") && input.synthesis?.proposals.length)
      return Promise.resolve(
        '{"decisions":[{"id":"uncertain","verdict":"reject","reason":"Needs independent evidence"}]}',
      );
    return complete(prompt, evidence, signal);
  };
  await runDream(f.deps, new AbortController().signal);
  expect(f.records.get(original.ref)?.memory_metadata?.stage).toBe("durable");
  const writesBefore = f.writes.length;
  for (let i = 0; i < 21; i++) {
    const r = record(i.toString(16).padStart(64, "0"));
    f.records.set(r.ref, { ...r, review_fingerprint: digest(i) });
  }
  f.deps.now = () => new Date("2026-11-07T04:00:00Z");
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes.length - writesBefore).toBe(20);
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    pending: { ref: string }[];
  };
  expect(state.pending.map((p) => p.ref)).not.toContain(original.ref);
  expect(state.pending).toHaveLength(2);
});

test("lost acknowledgement replays frozen request across days, never repeats stage calls or the write", async () => {
  const f = await fixture();
  f.loseNextAck();
  await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow("lost ack");
  f.deps.now = () => new Date("2026-11-07T04:00:00Z");
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes).toHaveLength(1);
  expect(f.calls).toEqual(["cleanup", "synthesis", "challenge", "reflection"]);
});

test("invalid project publication leaves its originals intact without blocking another project", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const atlas = { ...original, projects: ["atlas"] };
  const beacon = { ...original, ref: "c".repeat(64), projects: ["beacon"] };
  f.records.set(atlas.ref, atlas);
  f.records.set(beacon.ref, beacon);
  f.deps.prepareProjects = () => Promise.resolve(["beacon", "global"]);
  const complete = f.deps.complete;
  f.deps.complete = (prompt, evidence, signal) => {
    if (prompt.includes("Stage: cleanup"))
      return Promise.resolve(
        JSON.stringify({
          operations: [atlas, beacon].map((r) => ({
            id: r.projects[0],
            type: "replace",
            ref: r.ref,
            summary: "Clarified fact",
            content: `Clarified ${r.projects[0]} fact`,
            kind: "event",
            memory_metadata: factMetadata(r),
          })),
        }),
      );
    return complete(prompt, evidence, signal);
  };
  const outcome = await runDream(f.deps, new AbortController().signal);
  expect(outcome).toMatchObject({ status: "partial", error: { code: "project_catalog_conflict" } });
  expect(f.records.has(atlas.ref)).toBe(true);
  expect(f.records.has(beacon.ref)).toBe(false);
  expect([...f.records.values()].some((r) => r.content === "Clarified beacon fact")).toBe(true);
  expect([...f.records.values()].some((r) => r.content === "Clarified atlas fact")).toBe(false);
});

test("a journaled legacy publication finishes with its original identity before v3 review, without graph or owner-file writes", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  await writeFile(join(f.deps.directory, "ME.md"), "Owner-written text");
  await writeFile(
    join(f.deps.directory, "dream-state.json"),
    JSON.stringify({
      version: 2,
      run_id: "2026-11-06T03:00:00.000Z",
      window_start: 0,
      window_end: 1793937600,
      records: [original],
      recent_refs: [original.ref],
      operations: [
        {
          id: "prior",
          type: "insert",
          content: "An earlier journaled fact",
          kind: "observation",
          source_refs: [original.ref],
          summary: "Preserved an earlier validated fact",
        },
      ],
      results: [],
      profile_published: false,
      completed: false,
      handled: {},
    }),
  );
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes[0]).toBe("dream:2026-11-06T03:00:00.000Z:prior");
  expect(f.calls).toEqual(["cleanup", "synthesis", "challenge", "reflection"]);
  expect(await readFile(join(f.deps.directory, "ME.md"), "utf8")).toBe("Owner-written text");
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    legacy_receipts: unknown[];
  };
  expect(state.legacy_receipts).toHaveLength(1);
});

test("changed unpublished evidence discards only stale artifacts and remains pending", async () => {
  const f = await fixture();
  const original = [...f.records.values()][0];
  const complete = f.deps.complete;
  f.deps.complete = (prompt, evidence, signal) => {
    if (prompt.includes("Stage: challenge"))
      f.records.set(original.ref, {
        ...original,
        content: "Owner corrected the earlier fact",
        revision: "e".repeat(64),
        review_fingerprint: "e".repeat(64),
      });
    return complete(prompt, evidence, signal);
  };
  expect((await runDream(f.deps, new AbortController().signal)).status).toBe("partial");
  expect(f.writes).toEqual([]);
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    artifacts: unknown;
    completed: boolean;
  };
  expect(state.artifacts).toEqual({});
  expect(state.completed).toBe(false);
});

test("missing dispositions and persistent invalid challenge output publish nothing", async () => {
  for (const failure of ["cleanup", "challenge"]) {
    const f = await fixture();
    const complete = f.deps.complete;
    f.deps.complete = (prompt, evidence, signal) =>
      prompt.includes(`Stage: ${failure}`)
        ? Promise.resolve(
            failure === "cleanup" ? '{"facts":[],"dispositions":[]}' : '{"wrong":true}',
          )
        : complete(prompt, evidence, signal);
    await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  }
});

test.each(["cleanup", "challenge"])(
  "a persistently invalid %s batch rotates next day without losing pending inputs",
  async (failure) => {
    const f = await fixture();
    for (let i = 0; i < 25; i++) {
      const r = record(i.toString(16).padStart(64, "0"));
      f.records.set(r.ref, { ...r, review_fingerprint: digest(r) });
    }
    const complete = f.deps.complete;
    f.deps.complete = (prompt, evidence, signal) =>
      prompt.includes(`Stage: ${failure}`)
        ? Promise.resolve('{"wrong":true}')
        : complete(prompt, evidence, signal);
    const checkpoint = async () =>
      JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
        inputs: string[];
        pending: { ref: string }[];
        legacy_receipts: unknown[];
      };
    await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow();
    const first = await checkpoint();
    first.legacy_receipts = [{ ref: "e".repeat(64), operation: "preserved-legacy" }];
    await writeFile(join(f.deps.directory, "dream-state.json"), JSON.stringify(first));
    await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow();
    expect((await checkpoint()).inputs).toEqual(first.inputs);
    f.deps.now = () => new Date("2026-11-07T04:00:00Z");
    await expect(runDream(f.deps, new AbortController().signal)).rejects.toThrow();
    const next = await checkpoint();
    expect(next.legacy_receipts).toEqual(first.legacy_receipts);
    expect(next.inputs.some((ref) => !first.inputs.includes(ref))).toBe(true);
    expect(next.pending.map((p) => p.ref)).toEqual(expect.arrayContaining(first.inputs));
    expect(f.writes).toEqual([]);
  },
);
