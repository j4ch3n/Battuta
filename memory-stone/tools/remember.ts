import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { handle, kindSchema, result, scopeLabel, scopeSchema } from "./common.ts";

export function registerRemember(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_remember",
    label: "Remember",
    description:
      "Remember a detailed fact in project or global (personal/cross-project) scope. Project-specific or sensitive global content may be stored in project scope instead; report the actual scope. Credentials cannot be stored.",
    parameters: Type.Object({
      kind: kindSchema,
      text: Type.String(),
      scope: Type.Optional(scopeSchema),
      tags: Type.Optional(Type.String()),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
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
