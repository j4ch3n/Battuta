import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "../lifecycle.ts";
import { scopeLabel } from "../tools/common.ts";

export function registerForgetCommand(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerCommand("memory-forget", {
    description: "Forget a visible reference; --hard requires confirmation",
    handler: async (args, ctx) => {
      const [ref, flag] = args.trim().split(/\s+/);
      if (!ref || (flag && flag !== "--hard"))
        throw new Error("Usage: /memory-forget <ref> [--hard]");
      const binding = await runtime.binding(ctx.sessionManager.getSessionId());
      const record = runtime.store.open(binding, ref);
      if (
        flag === "--hard" &&
        (!ctx.hasUI ||
          !(await ctx.ui.confirm(
            "Permanently delete memory?",
            `${scopeLabel(record.scope, binding)}: ref=${ref}`,
          )))
      ) {
        ctx.ui.notify("Memory retained; permanent deletion was not confirmed.", "info");
        return;
      }
      runtime.store.forget(binding, ref, flag === "--hard");
      ctx.ui.notify(`Forgotten ${scopeLabel(record.scope, binding)} memory: ref=${ref}`, "info");
    },
  });
}
