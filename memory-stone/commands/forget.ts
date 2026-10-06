import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "../lifecycle.ts";
import { scopeLabel } from "../tools/common.ts";

export function registerForgetCommand(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerCommand("memory-forget", {
    description: "Permanently delete a visible reference without confirmation",
    handler: async (args, ctx) => {
      const [ref, ...extra] = args.trim().split(/\s+/);
      if (!ref || extra.length) throw new Error("Usage: /memory-forget <ref>");
      const binding = await runtime.binding(ctx.sessionManager.getSessionId());
      const record = runtime.store.open(binding, ref, "any");
      runtime.store.forget(binding, ref, true);
      runtime.invalidateRecall(ctx.sessionManager.getSessionId());
      ctx.ui.notify(
        `Permanently deleted ${scopeLabel(record.scope, binding)} memory: ref=${ref}`,
        "info",
      );
    },
  });
}
