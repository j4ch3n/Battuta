import { expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractMemories } from "../extract.ts";
import type { CaptureJob } from "../capture-queue.ts";

const job: CaptureJob = {
  id: "job",
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
            scope: { global: false, projects: ["atlas"] },
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
    { agent_id: "pm", session_id: "s", entry_id: "e" },
  ]);
});
test.each([
  "not json",
  JSON.stringify({
    items: [
      { content: "fact", scope: { global: false, projects: ["beacon"] }, source_entry_ids: ["e"] },
    ],
  }),
  JSON.stringify({
    items: [
      { content: "fact", scope: { global: true, projects: [] }, source_entry_ids: ["invented"] },
    ],
  }),
  JSON.stringify({
    items: [{ content: "x".repeat(1001), scope: { global: true }, source_entry_ids: ["e"] }],
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
}, 100);
test.each(["topic,scope:global", "topic,proj:other", "topic,kind:decision"])(
  "rejects comma-separated reserved tag injection: %s",
  async (tag) => {
    const content = JSON.stringify({
      items: [
        {
          content: "Atlas uses SQLite",
          scope: { global: false, projects: ["atlas"] },
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
  "PM_TELEGRAM_TOKEN=123456789:" + "A".repeat(35),
  "TL_TELEGRAM_TOKEN=987654321:" + "B".repeat(35),
])("accepts credential-like model output for local memory", async (content) => {
  const result = await extractMemories(
    job,
    context(
      JSON.stringify({ items: [{ content, scope: { global: true }, source_entry_ids: ["e"] }] }),
    ),
    new AbortController().signal,
  );

  expect(result.batch.items[0].content).toBe(content);
});
