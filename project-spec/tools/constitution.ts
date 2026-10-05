import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ProjectSpecStore } from "../store/index.ts";
import { argumentsFor, result, text } from "./parameters.ts";

const ReadParameters = Type.Object(
  { project: text("Exact registered project name.") },
  { additionalProperties: false },
);
const WriteParameters = Type.Object(
  {
    project: text("Exact registered project name."),
    summary: text("Short summary of this complete constitution version."),
    content: text("Full constitution Markdown; never a patch or append."),
  },
  { additionalProperties: false },
);

export function registerConstitutionTools(pi: ExtensionAPI, store: ProjectSpecStore) {
  pi.registerTool({
    name: "read_constitution",
    label: "Read constitution",
    description:
      "Read the project's canonical Constitution with its full Markdown, path, managed version, SHA-256 fingerprint, and terminal decision in one snapshot. Available to PM and TL, including after finalization.",
    parameters: ReadParameters,
    async execute(_id, args) {
      const input = argumentsFor(ReadParameters, args);
      return result(await store.readConstitution(input.project));
    },
  });
  if (store.role !== "pm") return;
  pi.registerTool({
    name: "init_constitution",
    label: "Create constitution",
    description:
      "PM only: create the canonical Constitution's first immutable managed version from complete Markdown. Existing constitutions require update_constitution. Not for ordinary Markdown documents.",
    parameters: WriteParameters,
    async execute(_id, args) {
      return result(await store.initConstitution(argumentsFor(WriteParameters, args)));
    },
  });
  pi.registerTool({
    name: "update_constitution",
    label: "Create next constitution version",
    description:
      "PM only: save complete revised Constitution Markdown as the next immutable managed version. Finalized constitutions reject changes. Returns saved path, managed version, and SHA-256 fingerprint. Not for ordinary Markdown documents.",
    parameters: WriteParameters,
    async execute(_id, args) {
      return result(await store.updateConstitution(argumentsFor(WriteParameters, args)));
    },
  });
}
