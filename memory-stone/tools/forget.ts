import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { handle, result, scopeLabel } from "./common.ts";

export function registerForget(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_forget",
    label: "Forget memory",
    description:
      "Soft-forget a visible memory on user request. Permanent deletion requires interactive user confirmation.",
    parameters: Type.Object({ ref: Type.String(), hard: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const record = runtime.store.open(binding, params.ref);
        if (
          params.hard &&
          (!ctx.hasUI ||
            !(await ctx.ui.confirm(
              "Permanently delete memory?",
              `${scopeLabel(record.scope, binding)}: ref=${record.id}`,
            )))
        )
          return result("Permanent deletion was not confirmed; memory was retained.", {
            requiresConfirmation: true,
          });
        runtime.store.forget(binding, params.ref, params.hard);
        return result(
          `${params.hard ? "Permanently deleted" : "Soft-forgotten"} ${scopeLabel(record.scope, binding)} memory: ref=${record.id}`,
          { scope: record.scope, ref: record.id, hard: params.hard ?? false },
        );
      }),
  });
}
