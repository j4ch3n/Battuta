import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, result, target } from "./parameters.ts";

export function registerReadTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  const empty = Type.Object({}, { additionalProperties: false });
  pi.registerTool({
    name: "list_projects",
    label: "List projects",
    description:
      "List existing registered projects and managed paths without changing project selection.",
    parameters: empty,
    async execute(_id, args) {
      argumentsFor(empty, args);
      return result(await store.listProjects());
    },
  });
  const project = Type.Object({ project: target.project }, { additionalProperties: false });
  pi.registerTool({
    name: "read_project_metadata",
    label: "Read project metadata",
    description:
      "Read project registration and specs/index.json. Versions, summaries and decisions are metadata, not proof of delivery.",
    parameters: project,
    async execute(_id, args) {
      const input = argumentsFor(project, args);
      return result(await store.readProjectMetadata(input.project));
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
      "Read version history, actual artifact presence, paths, review/checklist fingerprints and finalization. Read document contents with Pi read.",
    parameters: spec,
    async execute(_id, args) {
      const input = argumentsFor(spec, args);
      return result(await store.describeSpec(input.project, input.name, input.include_content));
    },
  });
}
