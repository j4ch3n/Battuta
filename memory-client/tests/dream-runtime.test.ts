import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import { runDream, type DreamDependencies } from "../dream-runtime.ts";
import { memoryRecordSchema, type MemoryRecord } from "../dream-mutations.ts";
import { validatePersonalProfile } from "../dream-personal.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

const dirs: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockReset();
  vi.mocked(rename).mockImplementation(
    (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rename,
  );
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test.each(["ME.md", "dream-profile.json"])(
  "a failed %s publication followed by an owner edit cannot erase tracked citations",
  async (failedFile) => {
    const f = await fixture();
    const signal = new AbortController().signal;
    await runDream(f.dependencies, signal);
    f.dependencies.now = () => new Date("2026-10-22T04:00:00Z");
    f.records.delete(pref);
    f.dependencies.complete = () => Promise.resolve(JSON.stringify(emptyProfile()));
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let failed = false;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (!failed && to === join(f.dependencies.directory, failedFile)) {
        failed = true;
        throw new Error("profile publish failed");
      }
      await real.rename(from, to);
    });
    await expect(runDream(f.dependencies, signal)).rejects.toThrow("profile publish failed");
    const current = await readFile(join(f.dependencies.directory, "ME.md"), "utf8");
    // An owner can restore old text while making an unrelated edit after failure.
    const edited = current.includes("Prefers concise replies.")
      ? current
      : current + "\nPrefers concise replies.\n";
    await writeFile(join(f.dependencies.directory, "ME.md"), edited + "\nOwner writes poetry.\n");
    f.dependencies.complete = (prompt) =>
      Promise.resolve(
        prompt.startsWith("Refresh")
          ? JSON.stringify({
              sections: {
                ...emptyProfile().sections,
                enduringPreferencesAndConstraints: [
                  { text: "Prefers concise replies.", source_refs: [] },
                ],
              },
            })
          : "Nothing material changed.",
      );
    await expect(runDream(f.dependencies, signal)).rejects.toThrow("Unsupported personal evidence");
    f.dependencies.complete = (prompt) =>
      Promise.resolve(
        prompt.startsWith("Refresh")
          ? JSON.stringify(emptyProfile())
          : "I removed the withdrawn preference from the profile.",
      );
    await runDream(f.dependencies, signal);
    expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).not.toContain(
      "Prefers concise replies.",
    );
  },
);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const parseEvidence = (text: string) =>
  JSON.parse(text) as {
    groups: { recent_refs: string[] }[];
    confirmed_changes: {
      before: string | null;
      after: string | null;
      current_active: boolean;
      current_content: string | null;
    }[];
    current_profile: string;
    partial: boolean;
  };
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
  const inactive = new Map<string, { ref: string; superseded_by: string | null }>();
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
          recent_refs: [...records.keys()],
          inactive: [...inactive.values()],
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
        return Promise.reject(Object.assign(new Error("changed"), { retryable: false }));
      const guards = args.evidence as { ref: string; revision: string }[] | undefined;
      if (guards?.some((guard) => records.get(guard.ref)?.revision !== guard.revision))
        return Promise.reject(Object.assign(new Error("evidence changed"), { retryable: false }));
      let result: unknown;
      if (name === "memory_forget") {
        records.delete(String(args.ref));
        inactive.set(String(args.ref), {
          ref: String(args.ref),
          superseded_by: typeof args.replacement_ref === "string" ? args.replacement_ref : null,
        });
        result = {
          ref: args.ref,
          forgotten: true,
          before: target!.content,
          after: null,
          revision: hash("forgotten"),
        };
      } else {
        const ref = hash(String(args.content));
        const existing = records.get(ref);
        if (!existing)
          records.set(ref, {
            ...record(ref, String(args.content)),
            scope:
              name === "memory_remember" ? (args.scope as MemoryRecord["scope"]) : target!.scope,
          });
        if (name === "memory_update") {
          records.delete(String(args.ref));
          inactive.set(String(args.ref), { ref: String(args.ref), superseded_by: ref });
        }
        result = {
          ref,
          outcome: existing ? "reused" : "created",
          before: name === "memory_update" ? target!.content : (existing?.content ?? null),
          after: records.get(ref)!.content,
          revision: records.get(ref)!.revision,
        };
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

test("update-based merge cleanup guards its acknowledged replacement instead of its superseded input", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Consolidate"))
      return Promise.resolve(
        JSON.stringify({
          operations: [
            {
              id: "merge",
              type: "update",
              ref: old,
              content: "Current decision",
              reason: "Combine",
              source_refs: [old, duplicate],
            },
            {
              id: "cleanup",
              type: "forget",
              ref: duplicate,
              reason: "Merged",
              replacement_id: "merge",
              source_refs: [old, duplicate],
            },
          ],
        }),
      );
    if (!prompt.startsWith("Refresh")) expect(parseEvidence(input).partial).toBe(false);
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toEqual(["memory_update", "memory_forget"]);
  expect(f.records.has(old)).toBe(false);
  expect(f.records.has(duplicate)).toBe(false);
  expect(f.records.get(hash("Current decision"))?.content).toBe("Current decision");
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

const emptyProfile = () => ({
  sections: {
    backgroundAndRole: [],
    goalsAndPriorities: [],
    valuesAndDecisionMaking: [],
    lifeContextAndInterests: [],
    enduringPreferencesAndConstraints: [],
  },
});

test("next day revisits concurrent captures and membership revisions, not the final snapshot", async () => {
  const f = await fixture();
  const external = hash("concurrent capture");
  let day = 1,
    secondDayPlans = 0;
  f.dependencies.now = () => new Date(`2026-10-${day === 1 ? "21" : "22"}T04:00:00Z`);
  f.dependencies.complete = (prompt, input) => {
    if (prompt.startsWith("Consolidate")) {
      if (day === 2) {
        secondDayPlans++;
        const groups = parseEvidence(input).groups;
        expect(groups.flatMap((group) => group.recent_refs).sort()).toEqual([old, external].sort());
      }
      return Promise.resolve('{"operations":[]}');
    }
    if (prompt.startsWith("Refresh")) {
      if (day === 1) {
        f.records.set(external, record(external, "Concurrent capture"));
        f.records.set(old, {
          ...f.records.get(old)!,
          scope: { global: false, projects: ["atlas", "beacon"] },
          revision: hash("membership changed"),
        });
      }
      return Promise.resolve(JSON.stringify(emptyProfile()));
    }
    return Promise.resolve("No material personal understanding changed.");
  };
  await runDream(f.dependencies, new AbortController().signal);
  day = 2;
  await runDream(f.dependencies, new AbortController().signal);
  expect(secondDayPlans).toBe(1);
});

test("lost-ack historical receipt after external forgetting is not reflected as a current fact", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Consolidate"))
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
          ],
        }),
      );
    if (prompt.startsWith("Write a private")) {
      const change = parseEvidence(input).confirmed_changes[0];
      expect(change.current_active).toBe(false);
      expect(change.current_content).toBe(null);
      expect(change.after).toBe("Combined implementation detail");
      return Promise.resolve(
        "A prior insertion was acknowledged, but its fact has since been withdrawn and is not current understanding.",
      );
    }
    return complete(prompt, input, signal);
  };
  f.loseNextAck();
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "lost acknowledgement",
  );
  f.records.delete(hash("Combined implementation detail"));
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toEqual(["memory_remember"]);
});

test.each([false, true])(
  "resynthesizes invalidated saved profile on retry (next day: %s) without replaying mutations",
  async (nextDay) => {
    const f = await fixture();
    await writeFile(join(f.dependencies.directory, "ME.md"), "Owner writes poetry.");
    const call = f.dependencies.call;
    let invalidated = false,
      drafts = 0;
    f.dependencies.call = (name, args, signal) => {
      if (name === "memory_inventory" && drafts === 1 && !invalidated) {
        invalidated = true;
        f.records.delete(pref);
      }
      return call(name, args, signal);
    };
    const complete = f.dependencies.complete;
    f.dependencies.complete = (prompt, input, signal) => {
      if (prompt.startsWith("Refresh")) {
        drafts++;
        return Promise.resolve(
          JSON.stringify({
            sections: {
              ...emptyProfile().sections,
              lifeContextAndInterests: [{ text: "Owner writes poetry.", source_refs: [] }],
              enduringPreferencesAndConstraints:
                drafts === 1 ? [{ text: "Prefers concise replies.", source_refs: [pref] }] : [],
            },
          }),
        );
      }
      return complete(prompt, input, signal);
    };
    await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
      "evidence changed",
    );
    expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toBe(
      "Owner writes poetry.",
    );
    if (nextDay) f.dependencies.now = () => new Date("2026-10-22T04:00:00Z");
    await runDream(f.dependencies, new AbortController().signal);
    expect(drafts).toBe(2);
    expect(f.applied).toHaveLength(3);
    expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).not.toContain(
      "Prefers concise",
    );
    expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toContain(
      "Owner writes poetry.",
    );
  },
);

test("rebases a saved draft on owner edits instead of overwriting or stranding it", async () => {
  const f = await fixture();
  const call = f.dependencies.call,
    complete = f.dependencies.complete;
  let drafted = false,
    interrupted = false;
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Refresh")) drafted = true;
    return complete(prompt, input, signal);
  };
  f.dependencies.call = (name, args, signal) => {
    if (name === "memory_inventory" && drafted && !interrupted) {
      interrupted = true;
      return Promise.reject(new Error("transport interrupted"));
    }
    return call(name, args, signal);
  };
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "transport interrupted",
  );
  await writeFile(join(f.dependencies.directory, "ME.md"), "Owner writes poetry.");
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Refresh")) {
      expect(parseEvidence(input).current_profile).toBe("Owner writes poetry.");
      return Promise.resolve(
        JSON.stringify({
          sections: {
            ...emptyProfile().sections,
            lifeContextAndInterests: [{ text: "Owner writes poetry.", source_refs: [] }],
          },
        }),
      );
    }
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
  expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toContain(
    "Owner writes poetry.",
  );
  expect(f.applied).toHaveLength(3);
});

test("detects owner edits during synthesis and safely rebases on retry", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  let drafts = 0;
  f.dependencies.complete = async (prompt, input, signal) => {
    if (prompt.startsWith("Refresh")) {
      drafts++;
      if (drafts === 1) {
        await writeFile(join(f.dependencies.directory, "ME.md"), "Owner writes poetry.");
        return complete(prompt, input, signal);
      }
      expect(parseEvidence(input).current_profile).toBe("Owner writes poetry.");
      return JSON.stringify({
        sections: {
          ...emptyProfile().sections,
          lifeContextAndInterests: [{ text: "Owner writes poetry.", source_refs: [] }],
        },
      });
    }
    return complete(prompt, input, signal);
  };
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "Owner profile changed",
  );
  expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toBe(
    "Owner writes poetry.",
  );
  await runDream(f.dependencies, new AbortController().signal);
  expect(drafts).toBe(2);
  expect(f.applied).toHaveLength(3);
});

test("reflection uses authoritative reused content, not a proposed insertion", async () => {
  const f = await fixture();
  const reused = hash("Combined implementation detail");
  f.records.set(reused, record(reused, "COMBINED implementation DETAIL"));
  const complete = f.dependencies.complete;
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Write a private")) {
      const changes = parseEvidence(input).confirmed_changes;
      expect(changes[0].before).toBe("COMBINED implementation DETAIL");
      expect(changes[0].after).toBe("COMBINED implementation DETAIL");
      expect(input).not.toContain('"after":"Combined implementation detail"');
    }
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
});

test("checkpoints mutation acknowledgement before authoritative follow-up reads", async () => {
  const f = await fixture();
  const call = f.dependencies.call;
  let failRead = true;
  f.dependencies.call = (name, args, signal) => {
    if (name === "memory_inventory" && f.applied.length === 1 && failRead) {
      failRead = false;
      return Promise.reject(new Error("read unavailable"));
    }
    return call(name, args, signal);
  };
  await expect(runDream(f.dependencies, new AbortController().signal)).rejects.toThrow(
    "read unavailable",
  );
  const saved = JSON.parse(
    await readFile(join(f.dependencies.directory, "dream-state.json"), "utf8"),
  ) as { results: unknown[] };
  expect(saved.results).toHaveLength(1);
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toHaveLength(3);
});

test("earlier plan mutations invalidating later cited sources finish as a terminal partial conflict", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Consolidate"))
      return Promise.resolve(
        JSON.stringify({
          operations: [
            {
              id: "correct",
              type: "update",
              ref: old,
              content: "Current decision",
              reason: "correction",
              source_refs: [old],
            },
            {
              id: "derived",
              type: "insert",
              content: "Must not derive stale evidence",
              kind: "observation",
              source_refs: [old],
            },
          ],
        }),
      );
    if (prompt.startsWith("Write a private")) {
      expect(parseEvidence(input).partial).toBe(true);
      return Promise.resolve(
        "I corrected the decision but did not apply a dependent stale proposal.",
      );
    }
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toEqual(["memory_update"]);
});

test("a source forgotten after planning rejects derived inserts as a terminal partial run", async () => {
  const f = await fixture();
  const call = f.dependencies.call,
    complete = f.dependencies.complete;
  f.dependencies.call = (name, args, signal) => {
    if (name === "memory_remember") f.records.delete(old);
    return call(name, args, signal);
  };
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Write a private")) {
      expect(parseEvidence(input).partial).toBe(true);
      expect(parseEvidence(input).confirmed_changes).toEqual([]);
      return Promise.resolve(
        "Concurrent withdrawal of evidence prevented consolidation; no derived memory was saved.",
      );
    }
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
  expect(f.applied).toEqual([]);
});

test.each(["atlas", "beacon"])(
  "post-cutoff initial context in scope %s stays eligible next day, including unvisited scopes",
  async (project) => {
    const f = await fixture();
    const external = hash("after cutoff");
    f.records.set(external, {
      ...record(external, "Captured after frozen cutoff"),
      scope: { global: false, projects: [project] },
    });
    const call = f.dependencies.call;
    let day = 1,
      plans = 0;
    f.dependencies.now = () => new Date(`2026-10-${day === 1 ? "21" : "22"}T04:00:00Z`);
    f.dependencies.call = async (name, args, signal) => {
      const result = await call(name, args, signal);
      return name === "memory_inventory" && day === 1
        ? { ...(result as Record<string, unknown>), recent_refs: [pref, old, duplicate] }
        : result;
    };
    f.dependencies.complete = (prompt, input) => {
      if (prompt.startsWith("Consolidate")) {
        if (day === 2) {
          plans++;
          expect(parseEvidence(input).groups.flatMap((g) => g.recent_refs)).toEqual([external]);
        }
        return Promise.resolve('{"operations":[]}');
      }
      return Promise.resolve(
        prompt.startsWith("Refresh")
          ? JSON.stringify(emptyProfile())
          : "No material personal understanding changed.",
      );
    };
    await runDream(f.dependencies, new AbortController().signal);
    day = 2;
    await runDream(f.dependencies, new AbortController().signal);
    expect(plans).toBe(1);
  },
);

test("only the acknowledged output revision is handled, not a later external membership edit", async () => {
  const f = await fixture();
  const complete = f.dependencies.complete;
  const output = hash("Combined implementation detail");
  let day = 1,
    plans = 0;
  f.dependencies.now = () => new Date(`2026-10-${day === 1 ? "21" : "22"}T04:00:00Z`);
  f.dependencies.complete = (prompt, input, signal) => {
    if (prompt.startsWith("Consolidate") && day === 2) {
      plans++;
      expect(parseEvidence(input).groups.flatMap((g) => g.recent_refs)).toEqual([output]);
      return Promise.resolve('{"operations":[]}');
    }
    if (prompt.startsWith("Refresh") && day === 1)
      f.records.set(output, {
        ...f.records.get(output)!,
        scope: { global: false, projects: ["atlas", "beacon"] },
        revision: hash("edited output membership"),
      });
    if (prompt.startsWith("Write a private") && day === 2)
      return Promise.resolve("No further consolidation was needed.");
    return complete(prompt, input, signal);
  };
  await runDream(f.dependencies, new AbortController().signal);
  day = 2;
  await runDream(f.dependencies, new AbortController().signal);
  expect(plans).toBe(1);
});

test("preserves established global profile understanding by re-citing an evidenced merge replacement", async () => {
  const f = await fixture();
  const second = hash("duplicate preference"),
    merged = hash("Concise answers are preferred");
  f.records.set(second, record(second, "Owner prefers concise answers", true));
  const previous = validatePersonalProfile(
    {
      sections: {
        ...emptyProfile().sections,
        enduringPreferencesAndConstraints: [
          { text: "Prefers concise replies.", source_refs: [pref] },
        ],
      },
    },
    [...f.records.values()],
    "",
    undefined,
  );
  await writeFile(join(f.dependencies.directory, "ME.md"), previous.content);
  await writeFile(join(f.dependencies.directory, "dream-profile.json"), JSON.stringify(previous));
  f.dependencies.complete = (prompt, input) => {
    if (prompt.startsWith("Consolidate"))
      return Promise.resolve(
        JSON.stringify({
          operations: [
            {
              id: "merge",
              type: "insert",
              content: "Concise answers are preferred",
              kind: "preference",
              source_refs: [pref, second],
            },
            {
              id: "retire_a",
              type: "forget",
              ref: pref,
              reason: "Merged duplicate",
              source_refs: [pref],
              replacement_id: "merge",
            },
            {
              id: "retire_b",
              type: "forget",
              ref: second,
              reason: "Merged duplicate",
              source_refs: [second],
              replacement_id: "merge",
            },
          ],
        }),
      );
    if (prompt.startsWith("Refresh")) {
      expect(prompt).toContain("active replacement chains");
      expect(prompt).toContain("withdrawn");
      const evidence = JSON.parse(input) as {
        inactive_refs: { ref: string; superseded_by: string | null }[];
      };
      expect(evidence.inactive_refs).toContainEqual({ ref: pref, superseded_by: merged });
      return Promise.resolve(
        JSON.stringify({
          sections: {
            ...emptyProfile().sections,
            enduringPreferencesAndConstraints: [
              { text: "Prefers concise replies.", source_refs: [merged] },
            ],
          },
        }),
      );
    }
    return Promise.resolve(
      "I consolidated duplicate global preferences without losing the established understanding in the owner profile.",
    );
  };
  await runDream(f.dependencies, new AbortController().signal);
  expect(await readFile(join(f.dependencies.directory, "ME.md"), "utf8")).toContain(
    "Prefers concise replies.",
  );
  expect(await readFile(join(f.dependencies.directory, "dream-profile.json"), "utf8")).toContain(
    merged,
  );
});
