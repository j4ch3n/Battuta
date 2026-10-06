import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { handle, result, scopeLabel } from "./common.ts";

export function registerForget(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_forget",
    label: "Forget memory",
    description:
      "Permanently delete an active or historical detailed memory reference from its scope and future recall. ME.md, transcripts, and already-sent prompts are unchanged.",
    parameters: Type.Object({
      ref: Type.String(),
    }),
    execute: async (_id, params, signal, _update, ctx) =>
      handle(async () => {
        signal?.throwIfAborted();
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const record = runtime.store.open(binding, params.ref, "any");
        signal?.throwIfAborted();
        runtime.store.forget(binding, params.ref, true);
        runtime.invalidateRecall(ctx.sessionManager.getSessionId());
        return result(
          `Permanently deleted ${scopeLabel(record.scope, binding)} SQLite memory: ref=${record.id}. ME.md and already-sent prompts/transcripts are unchanged; next-request recall excludes it.`,
          { store: "SQLite", scope: record.scope, ref: record.id, deleted: true },
        );
      }),
  });
}
