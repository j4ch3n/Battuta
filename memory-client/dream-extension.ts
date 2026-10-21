import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { clientConfig } from "./config.ts";
import { schedulerStorePath } from "./scheduler-config.ts";
import { enabledDreamModel } from "./dream-config.ts";
import { executeDream } from "./dream-executor.ts";
import { recordDreamUsage } from "./dream-usage.ts";

export default function dreamExtension(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "pm") return;
  const shutdown = new AbortController();
  let started = false;
  let active: Promise<void> | undefined;
  async function execute(ctx: ExtensionContext, signal?: AbortSignal) {
    try {
      const config = clientConfig();
      // Recheck even when joining active work: queued prompts cannot bypass disablement.
      const model = await enabledDreamModel(schedulerStorePath(), config.dataDirectory);
      if (!model) throw new Error("Dream not configured");
      if (!active) {
        ctx.ui.setStatus("memory-dream", "Memory dream running");
        active = executeDream(ctx, {
          model,
          shutdown: shutdown.signal,
          signal,
          onUsage: async (usage) => {
            const safe = await recordDreamUsage(config.dataDirectory, usage);
            pi.appendEntry("memory-dream-usage", { usage: safe });
          },
        }).finally(() => {
          active = undefined;
        });
      }
      await active;
      ctx.ui.setStatus("memory-dream", "Memory dream complete");
    } catch {
      ctx.ui.setStatus("memory-dream", "Memory dream unavailable or cancelled");
      throw new Error("Dream unavailable or cancelled");
    }
  }
  pi.registerTool({
    name: "memory_dream",
    label: "Memory dream",
    description:
      "Run the explicitly configured private memory dream. Returns completion status only, never private reflections. Does not accept custom prompts or models.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, _update, ctx) {
      await execute(ctx, signal);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "complete" }) }],
        details: { status: "complete" },
      };
    },
  });
  pi.on("session_start", (_event, ctx) => {
    if (started) return;
    started = true;
    void execute(ctx).catch(() => {});
  });
  pi.on("session_shutdown", () => shutdown.abort());
}
