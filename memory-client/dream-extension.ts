import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import { z } from "zod";
import { extractConversation, windowStart } from "./conversation-extract.ts";
import { failureReason } from "./recall.ts";
import { MemoryClient, type MemoryApi } from "./mcp-client.ts";

const POLL_MS = 10_000;
const MAX_WAIT_MS = 45 * 60_000;

const stateSchema = z.object({
  status: z.enum(["idle", "running", "succeeded", "failed"]),
  step: z.string().nullish(),
  last_success_at: z.string().nullish(),
  error: z.string().nullish(),
  report: z.record(z.string(), z.unknown()).nullish(),
});
type DreamState = z.infer<typeof stateSchema>;

export interface DreamOptions {
  sessionDir: string;
  signal: AbortSignal;
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

function summary(state: DreamState, uploaded: unknown) {
  const report = state.report ?? {};
  const distill = (report.distill ?? {}) as Record<string, { batches?: { written?: string[] }[] }>;
  const written = Object.values(distill).flatMap((day) =>
    (day.batches ?? []).flatMap((batch) => batch.written ?? []),
  );
  return {
    status: state.status,
    step: state.step ?? undefined,
    error: state.error ?? undefined,
    uploaded,
    memories_written: written.length,
    consolidation: report.consolidate,
    overviews_refreshed: report.overviews ?? [],
  };
}

/** Client side of the dream: extract and upload, then trigger and watch. No model work happens here. */
export async function runDream(client: MemoryApi, options: DreamOptions) {
  const { signal } = options;
  const sleep =
    options.sleep ?? ((ms: number, abort: AbortSignal) => delay(ms, undefined, { signal: abort }));
  const status = async () =>
    stateSchema.parse(await client.call("memory_dream_status", {}, signal));
  const before = await status();
  if (before.status === "running")
    return { status: "already_running", step: before.step ?? undefined };
  const since = windowStart(before.last_success_at, options.now?.() ?? new Date());
  const ndjson = await extractConversation(options.sessionDir, since);
  const uploaded = ndjson ? await client.uploadArchive(ndjson, signal) : { days: {} };
  const started = z
    .object({ status: z.string() })
    .parse(await client.call("memory_dream_start", {}, signal));
  if (started.status === "already_running") return { status: "already_running", uploaded };
  const deadline = Date.now() + (options.maxWaitMs ?? MAX_WAIT_MS);
  for (;;) {
    await sleep(options.pollMs ?? POLL_MS, signal);
    const state = await status();
    if (state.status !== "running") return summary(state, uploaded);
    if (Date.now() > deadline)
      return { status: "still_running", step: state.step ?? undefined, uploaded };
  }
}

export default function dreamExtension(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "cos") return;
  pi.registerTool({
    name: "memory_dream",
    label: "Memory dream",
    description:
      "Run the memory dream: upload recent owner conversation, then let the memory service distill, consolidate and refresh overviews. Call it only for the scheduled dream prompt or when the owner explicitly asks. Report the returned status and counts honestly; never invent a summary.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, _update, ctx) {
      const abort = signal ?? new AbortController().signal;
      ctx.ui.setStatus("memory-dream", "Memory dream running");
      try {
        const result = await runDream(new MemoryClient(), {
          sessionDir: ctx.sessionManager.getSessionDir(),
          signal: abort,
        });
        ctx.ui.setStatus("memory-dream", `Memory dream ${result.status.replaceAll("_", " ")}`);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const result = { status: "failed", error: failureReason(error) };
        ctx.ui.setStatus("memory-dream", "Memory dream failed");
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      }
    },
  });
}
