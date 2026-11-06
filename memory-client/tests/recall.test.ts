import { expect, test } from "vitest";
import { prepareRecall, renderMemories } from "../recall.ts";
import type { RequestBinding } from "../binding.ts";
import type { MemoryRecord } from "../records.ts";
import { record } from "./fixtures/record.ts";

export const binding: RequestBinding = {
  request_id: "r1",
  session_id: "s",
  conversation_id: "c",
  project: "atlas",
  origin: "owner",
  admitted_at: "2026-11-06T00:00:00Z",
};

test("follow-up recall uses recent topic with explicit frozen scope and revalidates before use", async () => {
  const r = record();
  const client = {
    call: (name: string, args: Record<string, unknown>) => {
      if (name === "memory_get") return Promise.resolve(r);
      expect(args.selector).toBe("projects");
      expect(args.projects).toEqual(["atlas"]);
      expect(Buffer.byteLength(String(args.query))).toBeLessThanOrEqual(256);
      return Promise.resolve({
        records: String(args.query).includes("Nintendo") ? [r] : [],
        incomplete: false,
      });
    },
  };
  const result = await prepareRecall(
    binding,
    "What should I get for it?",
    [{ entry_id: "e", text: "Nintendo console games", speaker: "owner" }],
    client,
    new AbortController().signal,
  );
  expect(result.records.map((r) => r.ref)).toEqual([r.ref]);
  expect(result.content).toContain("NS2");
  expect(result.request_id).toBe("r1");
});

test("timed-out and changed evidence never become a ready packet", async () => {
  const never = { call: () => new Promise<unknown>(() => {}) };
  expect(
    (await prepareRecall(binding, "Nintendo", [], never, AbortSignal.timeout(10))).status,
  ).toBe("unavailable");
  const r = record();
  const changed = {
    call: (name: string) =>
      Promise.resolve(
        name === "memory_get" ? { ...r, revision: "b".repeat(64) } : { records: [r] },
      ),
  };
  const packet = await prepareRecall(
    binding,
    "Nintendo",
    [],
    changed,
    new AbortController().signal,
  );
  expect(packet.records).toEqual([]);
  expect(packet.status).toBe("partial");
});

test("packet is bounded and omits a hypothesis whose counterevidence cannot fit", () => {
  const support = record();
  const counter = { ...record("b".repeat(64)), content: "Counterevidence ".repeat(150) };
  const hypothesis: MemoryRecord = {
    ...record("c".repeat(64)),
    content: "Possible interest",
    memory_metadata: {
      stage: "durable",
      knowledge_type: "hypothesis",
      confidence: "tentative",
      status: "active",
      keywords: [],
      rationale: "Possible explanation",
      evidence: [
        {
          ref: support.ref,
          revision: support.revision,
          relation: "supports",
          requirement: "historical",
        },
        {
          ref: counter.ref,
          revision: counter.revision,
          relation: "contradicts",
          requirement: "historical",
        },
      ],
    },
  };
  const result = renderMemories(
    [hypothesis, support],
    [support, counter, hypothesis],
    new Date(),
    2000,
  );
  expect(result.content).not.toContain("Possible interest");
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(2000);
});

test("three facets cap seeds, evidence expansion and packet bytes together", async () => {
  const all = Array.from({ length: 100 }, (_, i) => record(i.toString(16).padStart(64, "0")));
  for (let i = 0; i < 60; i++)
    all[i].memory_metadata!.evidence = [
      {
        ref: all[60 + (i % 40)].ref,
        revision: all[60 + (i % 40)].revision,
        relation: "supports",
        requirement: "historical",
      },
    ];
  const fetched = new Set<string>();
  let branch = 0;
  const client = {
    call: (name: string, args: Record<string, unknown>) => {
      if (name === "memory_get") {
        fetched.add(String(args.ref));
        return Promise.resolve(all.find((r) => r.ref === args.ref));
      }
      expect(Buffer.byteLength(String(args.query))).toBeLessThanOrEqual(256);
      const records = all.slice(branch * 20, ++branch * 20);
      return Promise.resolve({ records });
    },
  };
  const packet = await prepareRecall(
    binding,
    `NS2 ${"遊戲".repeat(300)}`,
    [{ entry_id: "topic", text: "Earlier Nintendo console topic" }],
    client,
    new AbortController().signal,
  );
  expect(branch).toBeLessThanOrEqual(3);
  expect(fetched.size).toBeLessThanOrEqual(60);
  expect(Buffer.byteLength(packet.content)).toBeLessThanOrEqual(2000);
  expect(packet.status).toBe("partial");
});
