import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "../lifecycle.ts";
import { displayRecord } from "../tools/common.ts";

export function registerRecall(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerCommand("memory-search", {
    description: "Search project memory; --global searches only global memory",
    handler: async (args, ctx) => {
      const global = args.trim().startsWith("--global ");
      const query = global ? args.trim().slice(9) : args.trim();
      const binding = await runtime.binding(ctx.sessionManager.getSessionId());
      const results = runtime.store.search(binding, query, global ? "global" : "project", 20);
      ctx.ui.notify(
        results.map((item) => displayRecord(item.record, binding)).join("\n") ||
          `No matching ${global ? "global" : "project"} entries for this query.`,
        "info",
      );
    },
  });
  pi.registerCommand("memory-open", {
    description: "Open a visible memory reference",
    handler: async (args, ctx) => {
      const binding = await runtime.binding(ctx.sessionManager.getSessionId());
      ctx.ui.notify(displayRecord(runtime.store.open(binding, args.trim()), binding), "info");
    },
  });
}
