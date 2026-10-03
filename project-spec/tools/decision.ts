import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, result, target, text } from "./parameters.ts";

export function registerDecisionTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  const parameters = Type.Object(
    {
      ...target,
      decision: Type.Union([Type.Literal("go"), Type.Literal("no-go")]),
      rationale: text(
        "Full decision rationale. Ask for or establish it before this call; the decision and rationale are saved together.",
      ),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "finalize_spec",
    label: "Finalize product decision",
    description:
      "PM only: create decision.md with rationale, SHA-256 fingerprint latest spec/checklist/decision/review, and record terminal go/no-go in JSON. Missing checklist/review yield null hashes; no quality/freshness gate. All further artifact writes are rejected. Product go is not execution/cycle authorization.",
    parameters,
    async execute(_id, args) {
      return result(await store.finalizeSpec(argumentsFor(parameters, args)));
    },
  });
}
