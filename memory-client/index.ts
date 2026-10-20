import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clientConfig, captureSettings } from "./config.ts";
import { profilePrompt } from "./profile-loader.ts";
import { resolveBinding } from "./binding.ts";
import { CaptureQueue } from "./capture-queue.ts";
import { CaptureRuntime } from "./lifecycle.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { extractMemories } from "./extract.ts";

export default function memoryClient(pi: ExtensionAPI) {
  let runtime: CaptureRuntime | undefined;
  let context: ExtensionContext;
  let serial = Promise.resolve();
  async function getRuntime(ctx: ExtensionContext) {
    context = ctx;
    if (!runtime) {
      const config = clientConfig();
      const settings = await captureSettings(config.directory);
      if (!settings.enabled) throw new Error("Capture disabled");
      const client = new MemoryMcpClient(config.url);
      runtime = new CaptureRuntime(
        await CaptureQueue.open(config.queue, config.role),
        {
          extract: (job, signal) =>
            extractMemories(job, context, signal, config.role, (usage) =>
              pi.appendEntry("memory-capture-usage", { usage }),
            ),
          upload: (batch, signal) => client.capture(batch, signal),
          now: () => Date.now(),
          notify: (message) => context.ui.setStatus("memory-capture", message),
        },
        settings.batchMessages,
      );
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
    await safe(ctx, async () => {
      const r = await getRuntime(ctx);
      let binding: string | null = null;
      try {
        binding = await resolveBinding(clientConfig().registry);
      } catch {
        ctx.ui.setStatus(
          "memory-capture",
          "Invalid project selection; project facts will not be captured",
        );
      }
      await r.startRequest(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getBranch(),
        binding,
      );
    });
    try {
      const config = clientConfig();
      const profile = await profilePrompt(config.role, config.directory);
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
