import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { runDream, type DreamDependencies } from "../dream-runtime.ts";
import { memoryRecordSchema, type MemoryRecord } from "../dream-mutations.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const pref = hash("preference"),
  old = hash("old"),
  duplicate = hash("duplicate");
const record = (ref: string, content: string, global = false): MemoryRecord =>
  memoryRecordSchema.parse({
    ref,
    revision: hash(content),
    content,
    scope: { global, projects: global ? [] : ["atlas"] },
    kind: "observation",
    tags: [],
    sources: [],
    active: true,
  });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dream-runtime-"));
  dirs.push(directory);
  const records = new Map(
    [
      record(pref, "Prefers concise replies", true),
      record(old, "Old decision"),
      record(duplicate, "Redundant detail"),
    ].map((r) => [r.ref, r]),
  );
  const receipts = new Map<string, unknown>();
  const applied: string[] = [];
  let planCalls = 0,
    loseAck = false;
  const dependencies: DreamDependencies = {
    directory,
    now: () => new Date("2026-10-21T04:00:00Z"),
    call: (name, args) => {
      if (name === "memory_inventory")
        return Promise.resolve({
          records: [...records.values()],
          recent_refs: [pref, old, duplicate],
          inactive: [],
          window_start: args.window_start,
          window_end: args.window_end,
        });
      const identity = name + JSON.stringify(args);
      if (receipts.has(identity)) return Promise.resolve(receipts.get(identity));
      const target = records.get(String(args.ref));
      if (name === "memory_get") {
        if (!target) return Promise.reject(new Error("inactive"));
        return Promise.resolve(target);
      }
      if (name !== "memory_remember" && target?.revision !== args.expected_revision)
        return Promise.reject(new Error("changed"));
      let result: unknown;
      if (name === "memory_forget") {
        records.delete(String(args.ref));
        result = { ref: args.ref, forgotten: true };
      } else {
        const ref = hash(String(args.content));
        records.set(ref, record(ref, String(args.content)));
        if (name === "memory_update") records.delete(String(args.ref));
        result = { ref, outcome: "created" };
      }
      applied.push(name);
      receipts.set(identity, result);
      if (loseAck) {
        loseAck = false;
        return Promise.reject(new Error("lost acknowledgement"));
      }
      return Promise.resolve(result);
    },
    complete: (prompt, evidence) => {
      if (prompt.startsWith("Consolidate")) {
        planCalls++;
        return Promise.resolve(
          JSON.stringify({
            operations: [
              {
                id: "insert",
                type: "insert",
                content: "Combined implementation detail",
                kind: "observation",
                source_refs: [old, duplicate],
              },
              {
                id: "correct",
                type: "update",
                ref: old,
                content: "Current decision",
                reason: "Latest evidence",
                source_refs: [old],
              },
              {
                id: "remove",
                type: "forget",
                ref: duplicate,
                reason: "Merged",
                source_refs: [duplicate],
                replacement_id: "insert",
              },
            ],
          }),
        );
      }
      if (prompt.startsWith("Refresh"))
        return Promise.resolve(
          JSON.stringify({
            sections: {
              backgroundAndRole: [],
              goalsAndPriorities: [],
              valuesAndDecisionMaking: [],
              lifeContextAndInterests: [],
              enduringPreferencesAndConstraints: [
                { text: "Prefers concise replies.", source_refs: [pref] },
              ],
            },
          }),
        );
      expect(evidence).toContain("Old decision");
      expect(evidence).toContain("Current decision");
      return Promise.resolve(
        "I corrected the project decision and combined overlapping implementation details. The personal profile now captures the preference for concise replies.",
      );
    },
  };
  return {
    dependencies,
    records,
    applied,
    plans: () => planCalls,
    loseNextAck: () => {
      loseAck = true;
    },
  };
}

test("applies insert/update/forget, publishes the whole profile, and appends a reflection once", async () => {
  const f = await fixture();
  await writeFile(join(f.dependencies.directory, "SUMMARY.md"), "Do not change");
  const signal = new AbortController().signal;
  const result = await runDream(f.dependencies, signal);
  expect(result).toContain("corrected the project decision");
  expect(f.applied).toEqual(["memory_remember", "memory_update", "memory_forget"]);
  expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toContain(
    "Prefers concise replies.",
  );
  expect(await readFile(join(f.dependencies.directory, "SUMMARY.md"), "utf8")).toBe(
    "Do not change",
  );
  expect(await runDream(f.dependencies, signal)).toBe(result);
  expect(f.plans()).toBe(1);
  expect(
    (await readFile(join(f.dependencies.directory, "dream.log"), "utf8")).trim().split("\n"),
  ).toHaveLength(1);
});

test("resumes a frozen plan after a lost acknowledgement without repeating model synthesis or writes", async () => {
  const f = await fixture();
  f.loseNextAck();
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "lost acknowledgement",
  );
  expect(f.applied).toEqual(["memory_remember"]);
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.plans()).toBe(1);
  expect(f.applied).toEqual(["memory_remember", "memory_update", "memory_forget"]);
});

test("rejects an invalid whole plan before the first mutation and preserves ME.md", async () => {
  const f = await fixture();
  await writeFile(join(f.dependencies.directory, "ME.md"), "Existing private profile");
  f.dependencies.complete = () =>
    Promise.resolve(
      '{"operations":[{"type":"forget","id":"bad","ref":"unknown","source_refs":[],"reason":"invented"}]}',
    );
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow();
  expect(f.applied).toEqual([]);
  expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toBe(
    "Existing private profile",
  );
});

test("a failed reflection retries independently of confirmed mutations", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  f.dependencies.complete = (prompt, input, signal) =>
    prompt.startsWith("Write a private")
      ? Promise.reject(new Error("provider down"))
      : complete(prompt, input, signal);
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "provider down",
  );
  expect(f.applied).toHaveLength(3);
  f.dependencies.complete = complete;
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toHaveLength(3);
  expect(f.plans()).toBe(1);
});

test("a terminal conflict logs only confirmed changes and leaves dependent cleanup unapplied", async () => {
  const f = await fixture();
  const call = f.dependencies.call,
    complete = f.dependencies.complete;
  f.dependencies.call = (name, args, signal) =>
    name === "memory_update"
      ? Promise.reject(Object.assign(new Error("private backend detail"), { retryable: false }))
      : call(name, args, signal);
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Write a private")) {
      expect(input).toContain('"partial":true');
      expect(input).not.toContain("private backend detail");
      return Promise.resolve(
        "I combined overlapping details, but a concurrent correction prevented the remaining changes. This dream was only partially applied.",
      );
    }
    return complete(prompt, input, signal);
  };
  const result = await runDream(f.dependencies, new AbortController().signal);
  expect(result).toContain("partially applied");
  expect(f.applied).toEqual(["memory_remember"]);
  expect(f.records.has(duplicate)).toBe(true);
});
