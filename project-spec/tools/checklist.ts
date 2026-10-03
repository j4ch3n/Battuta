import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, DocumentParameters, result } from "./parameters.ts";

export function registerChecklistTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  pi.registerTool({
    name: "write_spec_checklist",
    label: "Write canonical checklist",
    description:
      "TL only: create or fully replace the one canonical checklist for a spec across all versions. This file is the sole review-criteria source. No patch or append; finalized specs reject writes.",
    parameters: DocumentParameters,
    async execute(_id, args) {
      return result(await store.writeChecklist(argumentsFor(DocumentParameters, args)));
    },
  });
}
