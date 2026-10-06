import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MemoryRuntime } from "../lifecycle.ts";
import { displayRecord, handle, kindSchema, result, scopeLabel, scopeSchema } from "./common.ts";

export function registerSearch(pi: ExtensionAPI, runtime: MemoryRuntime) {
  pi.registerTool({
    name: "memory_search",
    label: "Search memory",
    description:
      "Search active detailed memories by keyword in project or global (personal/cross-project) scope. Omitted scope means the selected project. No matches does not mean the scope contains no records.",
    parameters: Type.Object({
      query: Type.String(),
      scope: Type.Optional(scopeSchema),
      kind: Type.Optional(kindSchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }),
    execute: async (_id, params, _signal, _update, ctx) =>
      handle(async () => {
        const binding = await runtime.binding(ctx.sessionManager.getSessionId());
        const scope = params.scope ?? "project";
        const found = runtime.store.search(binding, params.query, scope, params.limit, params.kind);
        return result(
          found.length
            ? found.map((item) => displayRecord(item.record, binding)).join("\n")
            : `No matching ${scope === "global" ? "global" : scopeLabel(scope, binding)} entries for this query.`,
          {
            scope,
            project: scope === "project" ? binding?.name : null,
            results: found.map((item) => ({ ...item.record, score: item.score })),
          },
        );
      }),
  });
}
