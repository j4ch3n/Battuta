import { expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractMemories } from "../extract.ts";
import type { CaptureJob } from "../capture-queue.ts";

const job: CaptureJob = {
  id: "job",
  project_catalog: ["atlas", "beacon", "My Project", "global"],
  session_id: "s",
  segment: { project: "atlas", messages: [{ entry_id: "e", text: "Use SQLite, not Postgres" }] },
  attempts: 0,
  nextAttempt: 0,
};
function context(content: string) {
  return {
    model: { id: "test" },
    modelRegistry: {
      complete: vi.fn(() =>
        Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: content }],
          usage: { input: 20, output: 5 },
        }),
      ),
    },
  } as unknown as ExtensionContext;
}
test("extracts cited facts with frozen binding and emits provider usage", async () => {
  const result = await extractMemories(
    job,
    context(
      JSON.stringify({
        items: [
          {
            content: "Atlas uses SQLite",
            projects: ["atlas"],
            source_entry_ids: ["e"],
          },
        ],
      }),
    ),
    new AbortController().signal,
  );
  expect(result.batch.items).toHaveLength(1);
  expect(result.usage).toEqual({ input: 20, output: 5 });
  expect(result.batch.items[0].sources).toEqual([
    { agent_id: "cos", session_id: "s", entry_id: "e" },
  ]);
});
test.each([
  "not json",
  JSON.stringify({
    items: [{ content: "fact", projects: ["global"], source_entry_ids: ["invented"] }],
  }),
  JSON.stringify({
    items: [{ content: "x".repeat(1001), projects: ["global"], source_entry_ids: ["e"] }],
  }),
])("rejects invalid, cross-project, uncited or oversized output", async (content) => {
  await expect(
    extractMemories(job, context(content), new AbortController().signal),
  ).rejects.toThrow();
});
test("empty extraction succeeds and cancellation is not a completed batch", async () => {
  expect(
    (await extractMemories(job, context('{"items":[]}'), new AbortController().signal)).batch.items,
  ).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  await expect(extractMemories(job, context('{"items":[]}'), controller.signal)).rejects.toThrow();
});
test("abort ends extraction even if provider ignores cancellation", async () => {
  const controller = new AbortController();
  const ctx = context('{"items":[]}');
  ctx.modelRegistry.complete = () => new Promise(() => {});
  const pending = extractMemories(job, ctx, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await expect(pending).rejects.toThrow();
});
test.each(["topic,scope:global", "topic,proj:other", "topic,kind:decision"])(
  "rejects comma-separated reserved tag injection: %s",
  async (tag) => {
    const content = JSON.stringify({
      items: [
        {
          content: "Atlas uses SQLite",
          projects: ["atlas"],
          tags: [tag],
          source_entry_ids: ["e"],
        },
      ],
    });
    await expect(
      extractMemories(job, context(content), new AbortController().signal),
    ).rejects.toThrow();
  },
);
test.each([
  "SUPABASE_SECRET_KEY=sb_secret_" + "s".repeat(32),
  "COS_TELEGRAM_TOKEN=123456789:" + "A".repeat(35),
  "MANAGER_TELEGRAM_TOKEN=987654321:" + "B".repeat(35),
])("rejects credential-like model output before upload", async (content) => {
  await expect(
    extractMemories(
      job,
      context(
        JSON.stringify({ items: [{ content, projects: ["global"], source_entry_ids: ["e"] }] }),
      ),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test("assistant-only evidence is not owner confirmation; unknown timezone cannot invent expiry", async () => {
  const attributed = {
    ...job,
    segment: {
      ...job.segment,
      messages: [
        {
          entry_id: "e",
          text: "Maybe buy a console",
          speaker: "assistant" as const,
          mentioned_at: "2026-11-06T10:00:00Z",
        },
      ],
    },
  };
  const item = {
    content: "Owner wants a console",
    projects: ["global"],
    source_entry_ids: ["e"],
    confidence: "confirmed",
  };
  await expect(
    extractMemories(
      attributed,
      context(JSON.stringify({ items: [item] })),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  await expect(
    extractMemories(
      job,
      context(JSON.stringify({ items: [{ ...item, expires_at: "2026-11-07T00:00:00Z" }] })),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test("saves catalog-valid entries across projects and returns only invalid entries for correction", async () => {
  const items = [
    { content: "Beacon uses SQLite", projects: ["beacon"], source_entry_ids: ["e"] },
    { content: "Shared deployment", projects: ["atlas", "beacon"], source_entry_ids: ["e"] },
    { content: "Unknown deployment", projects: ["atlas", "unknown"], source_entry_ids: ["e"] },
  ];
  const result = await extractMemories(
    job,
    context(JSON.stringify({ items })),
    new AbortController().signal,
  );
  expect(result.batch.items.map((item) => item.projects)).toEqual([
    ["beacon"],
    ["atlas", "beacon"],
  ]);
  expect(result.project_rejections).toMatchObject([{ index: 2, item: items[2] }]);
});

test("project correction and embedding rephrase never regenerate accepted entries", async () => {
  const rejected = { content: "Wrong project", projects: ["unknown"], source_entry_ids: ["e"] };
  const retry = {
    ...job,
    projectAttempts: 1,
    rephraseAttempts: 1,
    project_inputs: [{ index: 2, item: rejected }],
  };
  const corrected = {
    content: "Beacon uses SQLite",
    projects: ["beacon"],
    source_entry_ids: ["e"],
    retry_entry_id: 2,
  };
  const result = await extractMemories(
    retry,
    context(JSON.stringify({ items: [corrected] })),
    new AbortController().signal,
  );
  expect(result.batch.items[0].item_id).toBe("job:projects:1:rephrase:2");
  expect(result.project_rejections).toEqual([]);
  await expect(
    extractMemories(
      retry,
      context(JSON.stringify({ items: [{ ...corrected, retry_entry_id: 0 }] })),
      new AbortController().signal,
    ),
  ).rejects.toThrow("identity");
  await expect(
    extractMemories(retry, context('{"items":[]}'), new AbortController().signal),
  ).rejects.toThrow("omitted");
});
