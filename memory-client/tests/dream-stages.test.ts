import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { selectUnprocessed, validateCleanup } from "../dream-stages.ts";
import { runDream, type DreamDependencies } from "../dream-runtime.ts";
import { record } from "./fixtures/record.ts";
import { digest } from "../capture-queue.ts";
import { memoryRecordSchema, type MemoryRecord } from "../records.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test.each(["unknown-source", "cross-scope", "confidence-boost", "stale-evidence"])(
  "cleanup rejects %s before publication",
  (failure) => {
    const a = record(),
      b = { ...record("b".repeat(64)), scope: { global: false, projects: ["atlas"] } };
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
    directory,
    now: () => new Date("2026-11-06T04:00:00Z"),
    complete: (prompt, evidence) => {
      if (prompt.includes("Stage: cleanup")) {
        calls.push("cleanup");
        const input = JSON.parse(evidence) as { inputs: MemoryRecord[] };
        return Promise.resolve(
          JSON.stringify({
            facts: [],
            dispositions: input.inputs.map((r) => ({
              ref: r.ref,
              disposition: "retain",
              reason: "Useful attributed fact",
            })),
          }),
        );
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
          scope: args.scope,
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
  expect(state.version).toBe(3);
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
          dispositions: [
            {
              ref: original.ref,
              disposition: "replace",
              replacement_id: "purchase",
              reason: "Clarified supported console name",
            },
          ],
          facts: [
            {
              id: "purchase",
              content: "Owner reported buying a Nintendo Switch 2",
              kind: "event",
              source_refs: [original.ref],
              memory_metadata: original.memory_metadata,
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

test("deferred and unselected work remains pending, and earlier deferrals cannot starve the next bounded batch", async () => {
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
        '{"decisions":[{"id":"uncertain","verdict":"defer","reason":"Needs independent evidence"}]}',
      );
    return complete(prompt, evidence, signal);
  };
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes).toEqual([]);
  expect(f.records.get(original.ref)?.memory_metadata?.stage).toBe("temporal");
  for (let i = 0; i < 21; i++) {
    const r = record(i.toString(16).padStart(64, "0"));
    f.records.set(r.ref, { ...r, review_fingerprint: digest(i) });
  }
  f.deps.now = () => new Date("2026-11-07T04:00:00Z");
  await runDream(f.deps, new AbortController().signal);
  expect(f.writes).toHaveLength(20);
  const state = JSON.parse(await readFile(join(f.deps.directory, "dream-state.json"), "utf8")) as {
    pending: { ref: string }[];
  };
  expect(state.pending.map((p) => p.ref)).toContain(original.ref);
  expect(state.pending).toHaveLength(3);
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
