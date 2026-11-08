import { expect, test } from "vitest";
import { prepareRecall, prepareCorrectionCandidates, renderMemories } from "../recall.ts";
import type { RequestBinding } from "../binding.ts";
import type { MemoryRecord } from "../records.ts";
import { record } from "./fixtures/record.ts";
import { eligibleRecords } from "../records.ts";
import { boundRecentMessages } from "../session-messages.ts";

export const binding: RequestBinding = {
  request_id: "r1",
  session_id: "s",
  conversation_id: "c",
  project: "atlas",
  origin: "owner",
  admitted_at: "2026-11-06T00:00:00Z",
};

test.each([false, true])(
  "recent same-conversation history survives a new admission but excludes mixed queued mail (mixed=%s)",
  (mixed) => {
    const entries: unknown[] = [
      {
        type: "custom",
        customType: "memory-request-origin",
        data: { ...binding, request_id: "previous" },
      },
      {
        type: "custom",
        customType: "memory-request",
        data: { ...binding, request_id: "previous" },
      },
      { id: "owner", type: "message", message: { role: "user", content: "Nintendo games" } },
    ];
    if (mixed)
      entries.push({
        id: "mail",
        type: "custom_message",
        customType: "agent-mail",
        content: "Unvalidated report",
      });
    entries.push({ type: "custom", customType: "memory-request-origin", data: binding });
    expect(boundRecentMessages(entries, binding).map((m) => m.text)).toEqual(
      mixed ? [] : ["Nintendo games"],
    );
  },
);

test("undisclosed support remains available for dependency revalidation", async () => {
  const support = { ...record("b".repeat(64)), content: "Private supporting event" };
  support.memory_metadata!.expires_at = new Date(Date.now() + 60000).toISOString();
  const claim = record();
  claim.memory_metadata = {
    ...claim.memory_metadata!,
    knowledge_type: "hypothesis",
    confidence: "tentative",
    rationale: "Possible pattern",
    evidence: [
      {
        ref: support.ref,
        revision: support.revision,
        relation: "supports",
        requirement: "current",
      },
    ],
  };
  const packet = await prepareRecall(
    binding,
    "Nintendo",
    [],
    {
      call: (name, args) =>
        Promise.resolve(
          name === "memory_get"
            ? args.ref === support.ref
              ? support
              : claim
            : { records: [claim] },
        ),
    },
    new AbortController().signal,
  );
  expect(packet.records.map((r) => r.ref)).toEqual([claim.ref]);
  expect(packet.content).not.toContain(support.content);
  expect(eligibleRecords(packet.validationEvidence, new Date()).map((r) => r.ref)).toContain(
    claim.ref,
  );
  expect(eligibleRecords(packet.validationEvidence, new Date(Date.now() + 120000))).toEqual([]);
});

test("corrections can target expired events behind live historical patterns, never foreign scope", async () => {
  const event = record("b".repeat(64)),
    pattern = record(),
    foreign = { ...record("c".repeat(64)), projects: ["beacon"] };
  event.memory_metadata!.expires_at = "2020-01-01T00:00:00Z";
  pattern.memory_metadata!.evidence = [
    { ref: event.ref, revision: event.revision, relation: "supports", requirement: "historical" },
    {
      ref: foreign.ref,
      revision: foreign.revision,
      relation: "contradicts",
      requirement: "historical",
    },
  ];
  const candidates = await prepareCorrectionCandidates(
    ["atlas", "global"],
    "That event never happened",
    {
      call: (name, args) => {
        if (name === "memory_get") return Promise.resolve(args.ref === event.ref ? event : foreign);
        expect(args).toMatchObject({
          include_expired: true,
          selector: "projects",
          projects: ["atlas"],
          limit: 20,
        });
        return Promise.resolve({ records: [pattern] });
      },
    },
    new AbortController().signal,
  );
  expect(candidates.map((r) => r.ref)).toEqual([pattern.ref, event.ref]);
});

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
