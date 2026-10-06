import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { displayRecord, handle, result, statusSchema } from "./common.ts";

export function registerOpen(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_open",
    label: "Open memory",
    description:
      "Read the full content of a visible detailed memory reference. Defaults to active records; choose soft_forgotten to inspect inactive history. References may belong to global or the selected project scope.",
    parameters: Type.Object({ ref: Type.String(), status: Type.Optional(statusSchema) }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const record = runtime.store.open(binding, params.ref, params.status);
        return result(displayRecord(record, binding), {
          record,
          project: record.scope === "project" ? binding?.name : null,
        });
      }),
  });
}
