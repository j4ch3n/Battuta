import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { digest } from "../canonical.ts";
import { eligibleRecords, inRequestScope, memoryRecordSchema } from "../records.ts";
import { prepareRecall } from "../recall.ts";
import { prepareDelegation } from "../delegation.ts";
import { requestContent } from "../../agent-mail/tests/fixtures.ts";

const scenarios = z
  .array(
    z.object({
      id: z.string(),
      query: z.string(),
      project: z.string().nullable(),
      required: z.array(z.string()),
      selected: z.array(z.string()),
      excluded: z.array(z.string()),
      memories: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          keywords: z.array(z.string()),
          knowledge_type: z.enum(["fact", "synthesized-observation", "hypothesis"]),
          confidence: z.enum(["confirmed", "supported", "tentative", "disputed"]),
          status: z.enum(["active", "rejected"]).optional(),
          expires_at: z.string().optional(),
          project: z.string().optional(),
          supports: z.array(z.string()).optional(),
        }),
      ),
    }),
  )
  .parse(
    JSON.parse(
      await readFile(new URL("./fixtures/memory-scenarios.json", import.meta.url), "utf8"),
    ),
  );

test.each(scenarios)(
  "$id preserves evidence labels, eligibility and explicit disclosure",
  async (scenario) => {
    const ref = (id: string) => digest([scenario.id, id]);
    const records = scenario.memories.map((memory) =>
      memoryRecordSchema.parse({
        ref: ref(memory.id),
        revision: digest(memory),
        content: memory.content,
        scope: { global: !memory.project, projects: memory.project ? [memory.project] : [] },
        kind: "observation",
        tags: [],
        active: true,
        sources: [{ agent_id: "cos", session_id: "synthetic-session", entry_id: memory.id }],
        memory_metadata: {
          stage: "durable",
          knowledge_type: memory.knowledge_type,
          confidence: memory.confidence,
          status: memory.status ?? "active",
          keywords: memory.keywords,
          expires_at: memory.expires_at ?? null,
          rationale: memory.supports
            ? "Qualified interpretation of the cited synthetic evidence"
            : null,
          evidence: (memory.supports ?? []).map((id) => ({
            ref: ref(id),
            revision: digest(scenario.memories.find((m) => m.id === id)),
            relation: "supports",
            requirement: "historical",
          })),
        },
      }),
    );
    const binding = {
      request_id: scenario.id,
      conversation_id: "synthetic-owner",
      session_id: "synthetic-session",
      project: scenario.project,
      origin: "owner" as const,
      admitted_at: "2026-11-06T00:00:00Z",
    };
    const client = {
      call: (name: string, args: Record<string, unknown>) =>
        Promise.resolve(
          name === "memory_get"
            ? records.find((r) => r.ref === args.ref)
            : {
                records: eligibleRecords(records, new Date()).filter((r) =>
                  inRequestScope(r, scenario.project),
                ),
              },
        ),
    };
    const packet = await prepareRecall(
      binding,
      scenario.query,
      [],
      client,
      new AbortController().signal,
    );
    for (const id of scenario.required)
      expect(packet.records.some((r) => r.ref === ref(id))).toBe(true);
    for (const id of scenario.excluded)
      expect(packet.records.some((r) => r.ref === ref(id))).toBe(false);
    const content = requestContent(scenario.query);
    if (!scenario.selected.length) content.context.push("memory-context:none-relevant");
    const delegated = await prepareDelegation(
      binding,
      content,
      scenario.selected.map(ref),
      client,
      new AbortController().signal,
    );
    const serialized = JSON.stringify(delegated);
    for (const memory of scenario.memories) {
      if (scenario.selected.includes(memory.id)) {
        expect(serialized).toContain(memory.content);
        expect(serialized).toContain(memory.confidence);
        expect(serialized).toContain(memory.knowledge_type);
      } else expect(serialized).not.toContain(memory.content);
    }
  },
);
