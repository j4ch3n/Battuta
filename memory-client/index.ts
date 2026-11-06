import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clientConfig, captureSettings } from "./config.ts";
import { profilePrompt } from "./profile-loader.ts";
import { resolveRequestBinding, type RequestBinding } from "./binding.ts";
import { CaptureQueue } from "./capture-queue.ts";
import { CaptureRuntime } from "./lifecycle.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { extractMemories } from "./extract.ts";
import { memoryRecordSchema } from "./records.ts";
import { z } from "zod";

export default function memoryClient(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "cos") return;
  let runtime: CaptureRuntime | undefined;
  let context: ExtensionContext;
  let serial = Promise.resolve();
  async function getRuntime(ctx: ExtensionContext) {
    context = ctx;
    if (!runtime) {
      const config = clientConfig();
      const settings = await captureSettings(config.directory, config.role);
      if (!settings.enabled) throw new Error("Capture disabled");
      const client = new MemoryMcpClient(config.url);
      runtime = new CaptureRuntime(await CaptureQueue.open(config.queue, config.role), {
        extract: async (job, signal) => {
          const result = z.object({ records: z.array(memoryRecordSchema) }).parse(
            await client.call(
              "memory_recall",
              {
                query: Buffer.from(job.segment.messages.map((m) => m.text).join(" "))
                  .subarray(0, 240)
                  .toString("utf8"),
                selector: job.segment.project ? "projects" : "global",
                projects: job.segment.project ? [job.segment.project] : [],
                limit: 20,
              },
              signal,
            ),
          );
          return extractMemories(
            job,
            context,
            signal,
            config.role,
            (usage) => pi.appendEntry("memory-capture-usage", { usage }),
            result.records,
          );
        },
        upload: (batch, signal) => client.capture(batch, signal),
        now: () => Date.now(),
        notify: (message) => context.ui.setStatus("memory-capture", message),
      });
    }
    return runtime;
  }
  function safe(ctx: ExtensionContext, action: () => Promise<void>) {
    serial = serial.then(action).catch((error: unknown) => {
      ctx.ui.setStatus(
        "memory-capture",
        error instanceof Error && error.message === "Capture disabled"
          ? "Memory capture disabled"
          : "Memory capture unavailable; conversation continues",
      );
    });
    return serial;
  }
  pi.on("session_start", (_event, ctx) =>
    safe(ctx, async () => {
      const r = await getRuntime(ctx);
      await r.initialize(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("before_agent_start", async (event, ctx) => {
    let binding: RequestBinding | undefined;
    await safe(ctx, async () => {
      const r = await getRuntime(ctx);
      const entries = ctx.sessionManager.getBranch();
      const origin = [...entries]
        .reverse()
        .find(
          (e) =>
            e.type === "custom" &&
            (e.customType === "memory-request" || e.customType === "memory-request-origin"),
        );
      try {
        binding = await resolveRequestBinding(
          origin?.type === "custom" && origin.customType === "memory-request-origin"
            ? origin.data
            : undefined,
          clientConfig().registry,
        );
        if (binding.session_id !== ctx.sessionManager.getSessionId())
          throw new Error("Wrong memory session");
        pi.appendEntry("memory-request", binding);
      } catch {
        ctx.ui.setStatus(
          "memory-capture",
          "Memory origin unavailable; capture and personalization disabled for this request",
        );
        binding = undefined;
      }
      await r.startRequest(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getBranch(),
        binding,
      );
    });
    if (!binding || binding.origin === "internal") return;
    try {
      const config = clientConfig();
      const profile = await profilePrompt(config.role, config.dataDirectory);
      if (profile) return { systemPrompt: `${event.systemPrompt}\n\n${profile}` };
    } catch {
      ctx.ui.notify("Owner profile unavailable; continuing without it", "warning");
    }
  });
  pi.on("agent_settled", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).settle(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  const flush = (ctx: ExtensionContext) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).flush(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    });
  pi.on("session_before_switch", (_event, ctx) => flush(ctx));
  pi.on("session_before_fork", (_event, ctx) => flush(ctx));
  pi.on("session_before_compact", (_event, ctx) => flush(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    runtime?.shutdown();
    return flush(ctx);
  });
}
