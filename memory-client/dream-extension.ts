import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { clientConfig } from "./config.ts";
import { optionalText } from "./dream-files.ts";
import { DREAM_JOB_ID } from "./dream-schedule.ts";
import { dreamCompletion } from "./dream-model.ts";
import { runDream } from "./dream-runtime.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";
import { recordDreamUsage } from "./dream-usage.ts";

// The pinned scheduler resolves models fuzzily. Refuse model drift before any
// evidence read, and require the narrowly owned workdir job for startup/tool use.
async function enabledJob(ctx: ExtensionContext): Promise<boolean> {
  const text = await optionalText(join(clientConfig().directory, "schedule-prompts.json"));
  if (!text) return false;
  const store = JSON.parse(text) as { version?: number; jobs?: Record<string, unknown>[] };
  const jobs = store.jobs?.filter(
    (j) => j.id === DREAM_JOB_ID || j.name === "nightly-memory-dream",
  );
  if (store.version !== 1 || jobs?.length !== 1) return false;
  const job = jobs[0];
  return (
    job.id === DREAM_JOB_ID &&
    job.name === "nightly-memory-dream" &&
    job.enabled === true &&
    job.type === "cron" &&
    job.schedule === "0 0 3 * * *" &&
    job.session === undefined &&
    job.notify === false &&
    job.model === `${ctx.model?.provider}/${ctx.model?.id}` &&
    Array.isArray(job.skills) &&
    job.skills.length === 0 &&
    Array.isArray(job.extensions) &&
    job.extensions.length === 1 &&
    job.extensions[0] === fileURLToPath(import.meta.url)
  );
}

export default function dreamExtension(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "pm") return;
  const shutdown = new AbortController();
  let started = false;
  async function execute(ctx: ExtensionContext, signal?: AbortSignal) {
    try {
      if (!(await enabledJob(ctx))) throw new Error("Dream not configured");
      const config = clientConfig();
      const bounded = AbortSignal.any([
        shutdown.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(600000),
      ]);
      bounded.throwIfAborted();
      ctx.ui.setStatus("memory-dream", "Memory dream running");
      const client = new MemoryMcpClient(config.url);
      const reflection = await runDream(
        {
          directory: config.dataDirectory,
          now: () => new Date(),
          complete: dreamCompletion(ctx, async (usage) => {
            const safe = await recordDreamUsage(config.dataDirectory, usage);
            pi.appendEntry("memory-dream-usage", { usage: safe });
          }),
          call: (name, args, abort) => abortable(client.call(name, args, abort), abort),
        },
        bounded,
      );
      ctx.ui.setStatus("memory-dream", "Memory dream complete");
      return reflection;
    } catch {
      ctx.ui.setStatus("memory-dream", "Memory dream unavailable or cancelled");
      throw new Error("Dream unavailable or cancelled");
    }
  }
  pi.registerTool({
    name: "memory_dream",
    label: "Memory dream",
    description:
      "Only in the isolated scheduled session: run private memory consolidation once and return its reflection unchanged.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, _update, ctx) {
      if (ctx.sessionManager.getSessionFile())
        throw new Error("Dream tool is available only in the isolated scheduled session");
      return { content: [{ type: "text", text: await execute(ctx, signal) }], details: {} };
    },
  });
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.sessionManager.getSessionFile()) {
      // In-memory scheduler children otherwise inherit Pi's default shell/file
      // tools. Never call request_tools or allow model-controlled tool changes.
      pi.setActiveTools(["memory_dream"]);
      return;
    }
    if (started) return;
    started = true;
    void enabledJob(ctx)
      .then((enabled) => (enabled ? execute(ctx) : undefined))
      .catch(() => {
        ctx.ui.setStatus("memory-dream", "Memory dream unavailable or cancelled");
      });
  });
  pi.on("session_shutdown", () => {
    shutdown.abort();
  });
}
