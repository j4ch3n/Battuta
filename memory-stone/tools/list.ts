import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { displayRecord, handle, result, scopeLabel, scopeSchema } from "./common.ts";

export function registerList(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_list",
    label: "List memory",
    description:
      "List active entries in one scope, with pagination. Use for requests to show memories rather than a keyword search.",
    parameters: Type.Object({
      scope: Type.Optional(scopeSchema),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const scope = params.scope ?? "project";
        const records = runtime.store.list(binding, scope);
        const offset = params.offset ?? 0;
        const page = records.slice(offset, offset + (params.limit ?? 20));
        return result(
          page.length
            ? page.map((record) => displayRecord(record, binding)).join("\n")
            : `No active entries on this page in ${scopeLabel(scope, binding)} memory.`,
          {
            scope,
            project: scope === "project" ? binding?.name : null,
            total: records.length,
            nextOffset: offset + page.length < records.length ? offset + page.length : null,
            results: page,
          },
        );
      }),
  });
}
