import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { dreamRunId, runDream, validateEdit, validateHypotheses } from "../dream-runtime.ts";
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
  const prompts = { edit: 0, hypothesize: 0 };
  let day = new Date("2026-11-17T12:00:00Z");
  const deps: DreamDependencies = {
    directory,
    now: () => day,
    prepareProjects: () => Promise.resolve(["atlas", "beacon", "global"]),
    call: backend.call,
    complete: (_prompt, ev) => {
      evidence.push(ev);
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
  return { deps, evidence, prompts, setDay: (d: Date) => (day = d) };
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
