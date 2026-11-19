import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  dreamRunId,
  runDream,
  validateCues,
  validateEdit,
  validateHypotheses,
} from "../dream-runtime.ts";
import type { DreamDependencies } from "../dream-runtime.ts";
import type { MemoryRecord } from "../records.ts";
import { record } from "./fixtures/record.ts";

test.each([
  [2026, 10, 8, 5, 29, 59, 999, 2026, 10, 7],
  [2026, 10, 8, 5, 30, 0, 0, 2026, 10, 8],
  [2026, 10, 8, 23, 59, 0, 0, 2026, 10, 8],
  [2026, 10, 1, 0, 0, 0, 0, 2026, 9, 31],
  [2027, 0, 1, 0, 0, 0, 0, 2026, 11, 31],
  [2026, 2, 8, 5, 29, 0, 0, 2026, 2, 7],
  [2026, 2, 8, 5, 30, 0, 0, 2026, 2, 8],
  [2026, 10, 1, 5, 29, 0, 0, 2026, 9, 31],
  [2026, 10, 1, 5, 30, 0, 0, 2026, 10, 1],
])("dream run id uses the local 05:30 boundary %#", (y, m, d, h, mi, s, ms, dy, dm, dd) => {
  expect(dreamRunId(new Date(y, m, d, h, mi, s, ms))).toBe(
    new Date(dy, dm, dd, 5, 30).toISOString(),
  );
});

const hex = (n: number) => n.toString(16).padStart(64, "0");
const mem = (n: number, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ...record(hex(n)),
  revision: hex(1000 + n),
  content,
  projects: ["atlas"],
  sources: [{ agent_id: "cos", session_id: "s", entry_id: `e${n}` }],
  ...extra,
});
const withMeta = (patch: Record<string, unknown>) => ({
  memory_metadata: { ...record().memory_metadata!, ...patch } as MemoryRecord["memory_metadata"],
});

class Backend {
  records = new Map<string, MemoryRecord>();
  keys = new Map<string, string>();
  log: string[] = [];
  written: Record<string, unknown>[] = [];
  next = 100;
  failForgetOnce = false;
  clusters: string[][] = [];
  cueable = false;
  failCues = false;
  cued = new Map<string, Record<string, unknown>>();
  constructor(records: MemoryRecord[]) {
    for (const r of records) this.records.set(r.ref, r);
  }
  call: DreamDependencies["call"] = (name, args) => Promise.resolve(this.handle(name, args));
  handle(name: string, args: Record<string, unknown>): unknown {
    this.log.push(name);
    if (name === "memory_inventory") return { records: [...this.records.values()] };
    if (name === "memory_cluster") {
      const alive = this.clusters.filter((c) => c.every((r) => this.records.has(r)));
      return {
        projects: [
          {
            project: "atlas",
            clusters: alive,
            singletons: 0,
            largest: 2,
            raised: [{ from: 0.65, to: 0.7 }],
          },
        ],
      };
    }
    if (name === "memory_remember") {
      const key = args.idempotency_key as string;
      if (!this.keys.has(key)) {
        const ref = hex(this.next++);
        this.keys.set(key, ref);
        this.records.set(ref, {
          ...record(ref),
          revision: hex(5000 + this.next),
          content: args.content as string,
          projects: args.projects as string[],
          kind: args.kind as string,
          sources: args.sources as MemoryRecord["sources"],
          memory_metadata: args.memory_metadata as MemoryRecord["memory_metadata"],
        });
        this.written.push(args);
      }
      return { ref: this.keys.get(key) };
    }
    if (name === "memory_cue_targets") {
      const open = [...this.records.values()].filter((r) => this.cueable && !this.cued.has(r.ref));
      return { records: open.slice(0, args.limit as number) };
    }
    if (name === "memory_set_cues") {
      if (this.failCues) throw new Error("backend down");
      this.cued.set(args.ref as string, args);
      return { ref: args.ref, cues: (args.cues as unknown[]).length };
    }
    if (name === "memory_get") return this.records.get(args.ref as string);
    if (name === "memory_forget") {
      if (this.failForgetOnce) {
        this.failForgetOnce = false;
        throw new Error("backend down");
      }
      this.records.delete(args.ref as string);
      return { forgotten: true };
    }
    throw new Error(`unexpected ${name}`);
  }
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "dream-runtime-"));
});

const merge = {
  keep: [],
  remove: [1, 2],
  insert: [
    {
      content: "Atlas uses PostgreSQL 16",
      keywords: ["postgres"],
      confidence: "supported",
      expires_at: null,
    },
  ],
  summary: "Merged database notes.",
};
const REFLECTION = "Reviewed memory clusters.";

function harness(backend: Backend, edit: unknown, hypotheses: unknown = { hypotheses: [] }) {
  const evidence: string[] = [];
  const prompts = { edit: 0, hypothesize: 0, cues: 0 };
  const cueAnswer = {
    value: undefined as unknown,
    default: (ev: string) => ({
      memories: (JSON.parse(ev) as { cue_memories: { n: number }[] }).cue_memories.map(({ n }) => ({
        n,
        cues: [{ angle: "situation", text: `cue ${n}` }],
      })),
    }),
  };
  let day = new Date("2026-11-17T12:00:00Z");
  const deps: DreamDependencies = {
    directory,
    now: () => day,
    prepareProjects: () => Promise.resolve(["atlas", "beacon", "global"]),
    call: backend.call,
    complete: (_prompt, ev) => {
      evidence.push(ev);
      if (ev.includes('"cue_memories"')) {
        prompts.cues++;
        return Promise.resolve(JSON.stringify(cueAnswer.value ?? cueAnswer.default(ev)));
      }
      if (ev.includes('"memories"')) {
        prompts.edit++;
        return Promise.resolve(JSON.stringify(edit));
      }
      if (ev.includes('"clusters"')) {
        prompts.hypothesize++;
        return Promise.resolve(JSON.stringify(hypotheses));
      }
      return Promise.resolve(REFLECTION);
    },
  };
  return { deps, evidence, prompts, cueAnswer, setDay: (d: Date) => (day = d) };
}

const signal = () => new AbortController().signal;

test("edit replaces a cluster, hides refs from the model and links hypotheses to the result", async () => {
  const backend = new Backend([
    mem(1, "Atlas uses PostgreSQL"),
    mem(2, "Atlas database is Postgres 15"),
  ]);
  backend.clusters = [[hex(1), hex(2)]];
  const h = harness(backend, merge, {
    hypotheses: [
      {
        content: "Atlas favours Postgres",
        keywords: ["postgres"],
        rationale: "Repeated",
        clusters: [1],
      },
    ],
  });
  const outcome = await runDream(h.deps, signal());
  expect(outcome).toEqual({ status: "complete", summary: "Merged database notes." });
  expect(h.evidence.find((e) => e.includes('"memories"'))).not.toMatch(/[0-9a-f]{64}/);
  expect(backend.written).toHaveLength(2);
  expect(backend.written[0]).toMatchObject({
    projects: ["atlas"],
    sources: [
      expect.objectContaining({ entry_id: "e1" }),
      expect.objectContaining({ entry_id: "e2" }),
    ],
  });
  expect(backend.log.indexOf("memory_forget")).toBeGreaterThan(
    backend.log.indexOf("memory_remember"),
  );
  expect(backend.records.has(hex(1))).toBe(false);
  expect(backend.written[1]).toMatchObject({
    kind: "hypothesis",
    memory_metadata: {
      knowledge_type: "inference",
      confidence: "tentative",
      evidence: [
        { ref: [...backend.keys.values()][0], relation: "supports", requirement: "current" },
      ],
    },
  });
  const log = await readFile(join(directory, "dream.log"), "utf8");
  expect(log).toMatch(/step \S+ inventory projects=1 records=2 new=2/);
  expect(log).toMatch(/cluster project=atlas clusters=1 singletons=0 largest=2 raised=0.65->0.7/);
  expect(log).toMatch(/edit cluster=\w+ size=2 keep=0 remove=2 insert=1/);
  expect(log).toContain("publish inserted=1 retired=2");
  expect(log).toContain(REFLECTION);
});

test("expired records are removed before clustering", async () => {
  const backend = new Backend([
    mem(1, "Dentist on Friday", withMeta({ expires_at: "2026-11-01T00:00:00Z" })),
    mem(2, "Atlas uses SQLite"),
  ]);
  backend.clusters = [[hex(1), hex(2)]];
  const h = harness(backend, merge);
  await runDream(h.deps, signal());
  expect(backend.log.indexOf("memory_forget")).toBeLessThan(backend.log.indexOf("memory_cluster"));
  expect(h.prompts.edit).toBe(0);
  expect(backend.records.has(hex(1))).toBe(false);
  expect(await readFile(join(directory, "dream.log"), "utf8")).toContain("expire deleted=1");
});

test("an invalid model answer fails only its cluster and the run ends partial", async () => {
  const backend = new Backend([mem(1, "a"), mem(2, "b"), mem(3, "c"), mem(4, "d")]);
  backend.clusters = [
    [hex(1), hex(2)],
    [hex(3), hex(4)],
  ];
  const h = harness(backend, undefined);
  const complete = h.deps.complete;
  let calls = 0;
  h.deps.complete = (prompt, ev, s) => {
    if (!ev.includes('"memories"')) return complete(prompt, ev, s);
    calls++;
    return Promise.resolve(
      JSON.stringify(
        ev.includes('"content":"c"')
          ? { keep: [9], summary: "bad" }
          : { keep: [1, 2], summary: "Fine." },
      ),
    );
  };
  const outcome = await runDream(h.deps, signal());
  expect(outcome.status).toBe("partial");
  expect(calls).toBe(3);
  expect(backend.records.size).toBe(4);
});

test("a retry after a crash between insert and forget does not duplicate the insert", async () => {
  const backend = new Backend([
    mem(1, "Atlas uses PostgreSQL"),
    mem(2, "Atlas database is Postgres 15"),
  ]);
  backend.clusters = [[hex(1), hex(2)]];
  backend.failForgetOnce = true;
  const h = harness(backend, merge);
  await expect(runDream(h.deps, signal())).rejects.toThrow("backend down");
  expect((await runDream(h.deps, signal())).status).toBe("complete");
  expect(backend.written).toHaveLength(1);
  expect(h.prompts.edit).toBe(1);
  expect([...backend.records.keys()]).toEqual([[...backend.keys.values()][0]]);
});

test("unchanged reviewed clusters are not reviewed again, changed ones are", async () => {
  const backend = new Backend([mem(1, "a"), mem(2, "b")]);
  backend.clusters = [[hex(1), hex(2)]];
  const h = harness(backend, { keep: [1, 2], summary: "Nothing to merge." });
  await runDream(h.deps, signal());
  await runDream(h.deps, signal());
  expect(h.prompts.edit).toBe(1);
  h.setDay(new Date("2026-11-18T12:00:00Z"));
  const outcome = await runDream(h.deps, signal());
  expect(outcome).toEqual({ status: "complete", summary: "No memory changes were needed." });
  expect(h.prompts.edit).toBe(1);
  backend.records.set(hex(2), { ...backend.records.get(hex(2))!, revision: hex(9999) });
  h.setDay(new Date("2026-11-19T12:00:00Z"));
  await runDream(h.deps, signal());
  expect(h.prompts.edit).toBe(2);
});

const members = [
  mem(1, "one"),
  mem(2, "two"),
  mem(3, "three", withMeta({ confidence: "tentative" })),
];
const insert = (content: string, confidence = "tentative") => ({
  content,
  keywords: ["k"],
  confidence,
  expires_at: null,
});

test.each([
  [{ keep: [4], summary: "s" }, "Invalid memory number"],
  [{ keep: [0], summary: "s" }, "Invalid memory number"],
  [{ keep: [1], remove: [1], summary: "s" }, "Repeated memory number"],
  [{ insert: [insert("one")], summary: "s" }, "Duplicate proposed content"],
  [{ insert: [insert("x"), insert("x")], summary: "s" }, "Duplicate proposed content"],
])("validateEdit rejects %#", (value, error) => {
  expect(() => validateEdit(value, members, members)).toThrow(error);
});

test("validateEdit keeps omitted memories and caps insert confidence at the sources", () => {
  expect(validateEdit({ remove: [1], summary: "s" }, members, members)).toMatchObject({
    keep: [hex(2), hex(3)],
    remove: [hex(1)],
  });
  const weak = [members[2]];
  expect(() =>
    validateEdit({ insert: [insert("x", "confirmed")], summary: "s" }, weak, weak),
  ).toThrow("Dreaming cannot fabricate confirmation");
});

const hypothesis = (content: string, clusters: number[]) => ({
  content,
  keywords: ["k"],
  rationale: "r",
  clusters,
});
test.each([
  [{ hypotheses: [hypothesis("a", [3])] }, "Unknown cluster number"],
  [{ hypotheses: [hypothesis("a", [1]), hypothesis("a", [1])] }, "Duplicate proposed content"],
])("validateHypotheses rejects %#", (value, error) => {
  expect(() => validateHypotheses(value, 2)).toThrow(error);
});

test("validateHypotheses drops undeclared fields instead of failing the stage", () => {
  const value = {
    extra: 1,
    hypotheses: [hypothesis("a", [1]), { hypotheses: null, ...hypothesis("b", [2]) }],
  };
  const result = validateHypotheses(value, 2);
  expect(result).toHaveLength(2);
  expect(Object.keys(result[1]).sort()).toEqual(["clusters", "content", "keywords", "rationale"]);
});

test("cue stage writes cues after hypotheses and before the profile refresh", async () => {
  const backend = new Backend([
    mem(1, "Atlas uses PostgreSQL"),
    mem(2, "Atlas database is Postgres 15"),
  ]);
  backend.clusters = [[hex(1), hex(2)]];
  backend.cueable = true;
  const h = harness(backend, merge, {
    hypotheses: [
      { content: "Atlas favours Postgres", keywords: [], rationale: "Repeated", clusters: [1] },
    ],
  });
  expect((await runDream(h.deps, signal())).status).toBe("complete");
  const log = backend.log;
  expect(log.indexOf("memory_cue_targets")).toBeGreaterThan(log.lastIndexOf("memory_remember"));
  expect(log.indexOf("memory_cue_targets")).toBeLessThan(log.lastIndexOf("memory_inventory"));
  expect(backend.cued.size).toBe(backend.records.size);
  for (const [ref, args] of backend.cued) {
    expect(args).toMatchObject({
      expected_revision: backend.records.get(ref)!.revision,
      cues: [{ angle: "situation", text: expect.stringMatching(/^cue \d$/) as unknown }],
    });
  }
  expect(h.prompts.cues).toBe(1);
});

test("a memory the model gives no cues is written with an empty list", async () => {
  const backend = new Backend([mem(1, "Atlas uses PostgreSQL")]);
  backend.cueable = true;
  const h = harness(backend, merge);
  h.cueAnswer.value = { memories: [{ n: 1, cues: [] }] };
  await runDream(h.deps, signal());
  expect(backend.cued.get(hex(1))).toMatchObject({ cues: [] });
});

test("invalid cue output twice skips the batch and ends partial", async () => {
  const backend = new Backend([mem(1, "a"), mem(2, "b")]);
  backend.cueable = true;
  const h = harness(backend, merge);
  h.cueAnswer.value = { memories: [{ n: 9, cues: [] }] };
  expect((await runDream(h.deps, signal())).status).toBe("partial");
  expect(h.prompts.cues).toBe(2);
  expect(backend.log).not.toContain("memory_set_cues");
});

test("targets that keep failing are attempted once per run", async () => {
  const backend = new Backend([mem(1, "a"), mem(2, "b"), mem(3, "c")]);
  backend.cueable = true;
  backend.failCues = true;
  const h = harness(backend, merge);
  expect((await runDream(h.deps, signal())).status).toBe("complete");
  expect(backend.log.filter((n) => n === "memory_set_cues")).toHaveLength(3);
  expect(h.prompts.cues).toBe(1);
});

test("later targets are reached when the first batch keeps failing", async () => {
  const backend = new Backend(Array.from({ length: 25 }, (_, i) => mem(i + 1, `fact ${i + 1}`)));
  backend.cueable = true;
  const h = harness(backend, merge);
  const call = backend.call;
  backend.call = (name, args, s) =>
    name === "memory_set_cues" && parseInt(String(args.ref), 16) <= 20
      ? Promise.reject(new Error("down"))
      : call(name, args, s);
  h.deps.call = backend.call;
  await runDream(h.deps, signal());
  expect([...backend.cued.keys()].sort()).toEqual([21, 22, 23, 24, 25].map(hex));
});

const goodCues = { memories: [{ n: 1, cues: [{ angle: "own_words", text: "I use Postgres" }] }] };
test("validateCues returns numbered cues", () => {
  expect(validateCues(goodCues, 2)).toEqual(goodCues.memories);
});
test.each([
  ["number out of range", { memories: [{ n: 3, cues: [] }] }],
  ["number zero", { memories: [{ n: 0, cues: [] }] }],
  [
    "repeated number",
    {
      memories: [
        { n: 1, cues: [] },
        { n: 1, cues: [] },
      ],
    },
  ],
  ["bad angle", { memories: [{ n: 1, cues: [{ angle: "Own Words", text: "x" }] }] }],
  ["empty text", { memories: [{ n: 1, cues: [{ angle: "task", text: " " }] }] }],
  ["secret text", { memories: [{ n: 1, cues: [{ angle: "task", text: "password: hunter2" }] }] }],
])("validateCues rejects %s", (_name, value) => {
  expect(() => validateCues(value, 2)).toThrow();
});
