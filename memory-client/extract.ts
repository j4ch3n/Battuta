import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { digest, type CaptureJob } from "./capture-queue.ts";
import { redact } from "./privacy.ts";

const itemSchema = z
  .object({
    content: z.string().trim().min(1).max(1000),
    scope: z.object({ global: z.boolean(), projects: z.array(z.string()).default([]) }).strict(),
    kind: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,39}$/)
      .default("observation"),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(100)).max(100).default([]),
    source_entry_ids: z.array(z.string()).min(1).max(200),
  })
  .strict();
const schema = z.object({ items: z.array(itemSchema).max(20) }).strict();

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Extraction cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function extractMemories(
  job: CaptureJob,
  ctx: ExtensionContext,
  signal: AbortSignal,
  role: "pm" | "tl" = "pm",
  onUsage: (usage: unknown) => void = () => {},
) {
  signal.throwIfAborted();
  if (!ctx.model) throw new Error("No configured extraction model");
  const response = await abortable(
    ctx.modelRegistry.complete(
      ctx.model,
      {
        systemPrompt: await readFile(new URL("./prompts/capture.md", import.meta.url), "utf8"),
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              project: job.segment.project,
              messages: job.segment.messages,
              rephrase: job.rephraseAttempts
                ? "Previous extraction exceeded the embedding token limit. Split or shorten every fact to at most 100 words."
                : undefined,
            }),
            timestamp: Date.now(),
          },
        ],
      },
      { signal, maxTokens: 4096 },
    ),
    signal,
  );
  onUsage(response.usage);
  signal.throwIfAborted();
  if (response.stopReason !== "stop") throw new Error("Extraction did not finish");
  const parsed = schema.parse(
    JSON.parse(response.content.map((p) => (p.type === "text" ? p.text : "")).join("")),
  );
  const sourceIds = new Set(job.segment.messages.map((m) => m.entry_id));
  const items = parsed.items.map((item, i) => {
    if (
      redact(item.content) !== item.content ||
      item.tags.some((t) => redact(t) !== t || t.includes(",") || /^(scope|proj|kind):/.test(t))
    )
      throw new Error("Unsafe extracted memory");
    const projects = [...new Set(item.scope.projects)].sort();
    if (
      item.scope.global
        ? projects.length !== 0
        : projects.length !== 1 || projects[0] !== job.segment.project
    )
      throw new Error("Extraction scope conflict");
    if (item.source_entry_ids.some((id) => !sourceIds.has(id)))
      throw new Error("Unknown source citation");
    return {
      item_id: `${job.id}${job.rephraseAttempts ? ":rephrase" : ""}:${i}`,
      content: item.content,
      scope: { global: item.scope.global, projects },
      kind: item.kind,
      tags: [...new Set(item.tags)].sort(),
      sources: [...new Set(item.source_entry_ids)].map((entry_id) => ({
        agent_id: role,
        session_id: job.session_id,
        entry_id,
      })),
      idempotency_key: null,
    };
  });
  const payload = {
    session_id: job.session_id,
    batch_id: job.id + (job.rephraseAttempts ? ":rephrase" : ""),
    agent_id: role,
    items,
  };
  return { batch: { ...payload, payload_digest: digest(payload) }, usage: response.usage };
}
