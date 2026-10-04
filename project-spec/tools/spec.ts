import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, DocumentParameters, result } from "./parameters.ts";

export function registerSpecTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  pi.registerTool({
    name: "init_spec",
    label: "Create spec",
    description:
      "PM only: save the complete first spec version, v1. Existing names require update_spec. No separate publish step.",
    parameters: DocumentParameters,
    async execute(_id, args) {
      return result(await store.initSpec(argumentsFor(DocumentParameters, args)));
    },
  });
  pi.registerTool({
    name: "update_spec",
    label: "Create next spec version",
    description:
      "PM only: save complete Markdown as the next immutable version. Never modifies previous versions. Finalized specs reject updates.",
    parameters: DocumentParameters,
    async execute(_id, args) {
      return result(await store.updateSpec(argumentsFor(DocumentParameters, args)));
    },
  });
}
