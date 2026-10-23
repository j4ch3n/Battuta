import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseConfig } from "./policy.ts";
import { Runtime } from "./runtime.ts";

export default function (pi: ExtensionAPI) {
  let runtime: Runtime | undefined;
  let closing = false;
  const shutdown = async () => {
    closing = true;
    await runtime?.shutdown();
    runtime = undefined;
  };
  pi.on("session_shutdown", shutdown);
  pi.on("session_start", async () => {
    await shutdown();
    closing = false;
  });
  pi.registerTool({
    name: "bounded_subagents",
    label: "Bounded TL children",
    description:
      "Launch scoped scout, worker or reviewer children; inspect results/status or cancel by IDs. Supply objective, inputs, scope and expected evidence for each task. Background completion returns evidence to TL automatically. Workers edit disposable snapshots only. Results are not acceptance or verification. Capacity and grants are operator-controlled; no shell, nested delegation, inherited integrations or network research.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("launch"), Type.Literal("status"), Type.Literal("cancel")]),
      background: Type.Optional(Type.Boolean()),
      ids: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            profile: Type.Union([
              Type.Literal("scout"),
              Type.Literal("worker"),
              Type.Literal("reviewer"),
            ]),
            objective: Type.String(),
            inputs: Type.Array(Type.String(), { maxItems: 64 }),
            writable: Type.Optional(Type.Array(Type.String(), { maxItems: 64 })),
            scope: Type.String(),
            evidence: Type.String(),
          }),
          { minItems: 1, maxItems: 4 },
        ),
      ),
    }),
    async execute(_id, args, signal, _onUpdate, ctx) {
      if (closing) throw new Error("Subagent runtime is shutting down");
      if (!runtime) {
        const path = join(
          process.env.PI_CODING_AGENT_DIR ?? join(ctx.cwd, ".pi"),
          "subagents.json",
        );
        runtime = new Runtime(parseConfig(JSON.parse(readFileSync(path, "utf8"))));
      }
      const result = (jobs: ReturnType<Runtime["status"]>) => ({
        content: [{ type: "text" as const, text: JSON.stringify(jobs) }],
        details: { jobs },
        isError: jobs.some((job) => job.status === "failed" || job.status === "timed_out"),
      });
      const owner = runtime;
      if (args.action === "status") return result(owner.status(args.ids));
      if (args.action === "cancel") {
        if (!args.ids?.length) throw new Error("Cancellation requires child IDs");
        owner.status(args.ids); // Validate the whole request before side effects.
        args.ids.forEach((id) => owner.cancel(id));
        return result(await owner.wait(args.ids));
      }
      if (!args.tasks?.length) throw new Error("Launch requires tasks");
      if (signal?.aborted) throw new Error("Launch cancelled");
      const jobs = owner.start(args.tasks);
      const ids = jobs.map((job) => job.id);
      if (args.background) {
        void owner
          .wait(ids)
          .then((completed) => {
            if (!closing && runtime === owner)
              pi.sendMessage(
                {
                  customType: "bounded-subagent-results",
                  content: JSON.stringify(completed),
                  display: true,
                },
                { triggerTurn: true, deliverAs: "followUp" },
              );
          })
          .catch(() => {
            /* shutdown owns cleanup; foreground inspection retains errors */
          });
        return result(jobs);
      }
      const cancel = () => ids.forEach((id) => owner.cancel(id));
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        return result(await owner.wait(ids));
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
  });
}
