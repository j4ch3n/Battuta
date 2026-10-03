import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, DocumentParameters, result } from "./parameters.ts";

export function registerReviewTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  const parameters = Type.Object(
    {
      ...DocumentParameters.properties,
      spec_version: Type.String({
        pattern: "^v[1-9][0-9]*$",
        description:
          "Actual version assessed; obtain it from describe_spec before reading the spec.",
      }),
      checklist_sha256: Type.String({
        pattern: "^[a-f0-9]{64}$",
        description:
          "Fingerprint of the canonical checklist actually used, from describe_spec. Do not guess from the latest state after review.",
      }),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "write_spec_review",
    label: "Write spec review",
    description:
      "TL only: fully replace the one review using the canonical checklist. Record actual assessed inputs; stale coverage is allowed and reported honestly. Finalization has no review gate.",
    parameters,
    async execute(_id, args) {
      return result(await store.writeReview(argumentsFor(parameters, args)));
    },
  });
}
