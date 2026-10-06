import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { handle, kindSchema, result } from "./common.ts";

export function registerReplace(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_replace",
    label: "Correct memory",
    description:
      "Correct an active detailed memory reference in its existing scope. Retain the previous record as inactive history and use the correction for future recall. ME.md is unchanged.",
    parameters: Type.Object({
      ref: Type.String(),
      kind: kindSchema,
      text: Type.String(),
      tags: Type.Optional(Type.String()),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
    execute: async (_id, params, signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        signal?.throwIfAborted();
        const saved = runtime.store.replace(binding, params.ref, params);
        runtime.invalidateRecall(ctx.sessionManager.getSessionId());
        return result(
          "Corrected SQLite memory and retired predecessor. ME.md is unchanged; next request uses the correction.",
          {
            store: "SQLite",
            retiredRef: params.ref,
            ref: saved.record.id,
            scope: saved.record.scope,
          },
        );
      }),
  });
}
