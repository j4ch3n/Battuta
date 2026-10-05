import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { handle, kindSchema, result, scopeLabel, scopeSchema } from "./common.ts";

export function registerRemember(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_remember",
    label: "Remember",
    description:
      "Store memory only when the user asks. Set userRequested only for explicit remembering intent; globalRequested only for explicit cross-project/global storage intent. Sensitive global details may be downgraded; secrets are refused.",
    parameters: Type.Object({
      kind: kindSchema,
      text: Type.String(),
      scope: Type.Optional(scopeSchema),
      userRequested: Type.Optional(Type.Boolean()),
      globalRequested: Type.Optional(Type.Boolean()),
      tags: Type.Optional(Type.String()),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        if (!params.userRequested || (params.scope === "global" && !params.globalRequested))
          throw new Error(
            "Explicit user intent is required before storing memory, including explicit global intent for global storage",
          );
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const saved = runtime.store.remember(binding, params);
        const label = scopeLabel(saved.record.scope, binding);
        return result(
          `${saved.downgraded ? `Global request downgraded: ${saved.downgradeReason}. ` : ""}Stored in ${label} memory: ref=${saved.record.id}`,
          {
            scope: saved.record.scope,
            project: saved.record.scope === "project" ? binding?.name : null,
            ref: saved.record.id,
            downgraded: saved.downgraded,
            downgradeReason: saved.downgradeReason,
          },
        );
      }),
  });
}
