import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { displayRecord, handle, result } from "./common.ts";

export function registerOpen(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_open",
    label: "Open memory",
    description: "Read a visible global or selected-project memory by reference.",
    parameters: Type.Object({ ref: Type.String() }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const record = runtime.store.open(binding, params.ref);
        return result(displayRecord(record, binding), {
          record,
          project: record.scope === "project" ? binding?.name : null,
        });
      }),
  });
}
