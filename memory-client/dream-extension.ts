import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { clientConfig } from "./config.ts";
import { schedulerStorePath } from "./scheduler-config.ts";
import { enabledDreamModel } from "./dream-config.ts";
import { DreamExecutionError, type DreamFailure, executeDream } from "./dream-executor.ts";
import { recordDreamUsage } from "./dream-usage.ts";
import { abortable } from "./abortable.ts";
import type { DreamOutcome } from "./dream-result.ts";

export default function dreamExtension(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "pm") return;
  const shutdown = new AbortController();
  let started = false;
  let active: Promise<DreamOutcome> | undefined;
  async function execute(ctx: ExtensionContext, signal?: AbortSignal) {
    let configured = false;
    try {
      const config = clientConfig();
      // Recheck even when joining active work: queued prompts cannot bypass disablement.
      const model = await enabledDreamModel(schedulerStorePath(), config.dataDirectory);
      if (!model) throw new Error("Dream not configured");
      configured = true;
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
      const result = await abortable(active, signal ?? shutdown.signal);
      ctx.ui.setStatus("memory-dream", `Memory dream ${result.status.replaceAll("_", " ")}`);
      return result;
    } catch (error) {
      const failure: DreamFailure = !configured
        ? "unavailable"
        : error instanceof DreamExecutionError
          ? error.failure
          : signal?.aborted || shutdown.signal.aborted
            ? "cancelled"
            : "failed";
      const messages: Record<DreamFailure, string> = {
        unavailable: "Dream unavailable: configure an enabled nightly dream model and retry.",
        cancelled: "Dream cancelled: retry the next eligible scheduled run.",
        timed_out:
          "Dream timed out: review availability and retry the next eligible scheduled run.",
        failed: "Dream failed: review private operational logs and retry.",
      };
      ctx.ui.setStatus("memory-dream", `Memory dream ${failure.replace("_", " ")}`);
      throw new Error(messages[failure], { cause: error });
    }
  }
  pi.registerTool({
    name: "memory_dream",
    label: "Memory dream",
    description:
      "Run the explicitly configured memory dream. On success, report successful completion and the returned public summary. For partial, already completed without a summary, or failed runs, report the actual status honestly. Never request or repeat private reflections. Does not accept custom prompts or models.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, _update, ctx) {
      const result = await execute(ctx, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
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
