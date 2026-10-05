import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "../lifecycle.ts";
import type { MemoryConfig } from "../config.ts";

export function registerStatus(
  pi: ExtensionAPI,
  runtime: MemoryRuntime,
  path: string,
  config: MemoryConfig,
) {
  pi.registerCommand("memory-status", {
    description: "Show shared memory database, bound project, and recall settings",
    handler: async (_args, ctx) => {
      const binding = await runtime.binding(ctx.sessionManager.getSessionId());
      ctx.ui.notify(
        `Database: ${path}\nProject: ${binding ? `${binding.name} (${binding.projectId})` : "unavailable"}\nGlobal entries: ${runtime.store.list(null, "global").length}\nAutomatic recall: ${config.enabled ? "on" : "off"}`,
        "info",
      );
    },
  });
  pi.registerCommand("memory-last", {
    description: "Show this session's last memory injection",
    handler: (_args, ctx) => {
      ctx.ui.notify(
        runtime.store.stone.db.getLastInjection(ctx.sessionManager.getSessionId())?.packet ??
          "No memory injection recorded for this session.",
        "info",
      );
      return Promise.resolve();
    },
  });
}
