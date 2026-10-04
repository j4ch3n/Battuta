import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, result, target } from "./parameters.ts";

export function registerReadTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  const project = Type.Object({ project: target.project }, { additionalProperties: false });
  pi.registerTool({
    name: "inspect_specs",
    label: "Inspect specs",
    description:
      "Inspect a named project's spec inventory, versions, summaries, checklist/review metadata and decisions. Returns spec metadata only; use the project CLI for project discovery and workspace context. Metadata is not proof of delivery.",
    parameters: project,
    async execute(_id, args) {
      const input = argumentsFor(project, args);
      return result(await store.inspectSpecs(input.project));
    },
  });
  const spec = Type.Object(
    {
      ...target,
      include_content: Type.Optional(
        Type.Boolean({
          description:
            "Return full document text with its fingerprints in one locked snapshot. Use true for reviews to avoid separately reading changed inputs.",
        }),
      ),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "describe_spec",
    label: "Describe spec",
    description:
      "Read version history, actual artifact presence, paths, review/checklist fingerprints and finalization. Set include_content to read full documents with their fingerprints in one snapshot.",
    parameters: spec,
    async execute(_id, args) {
      const input = argumentsFor(spec, args);
      return result(await store.describeSpec(input.project, input.name, input.include_content));
    },
  });
}
