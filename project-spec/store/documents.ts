import { join } from "node:path";
import { nonblank, readOptional, sha256 } from "./files.ts";
import { assertOpen, findSpec, normalizeName, specPath, type Spec } from "./metadata.ts";
import type { Project } from "./projects.ts";
import { mutate } from "./transactions.ts";

export interface DocumentInput {
  project: string;
  name: string;
  summary: string;
  content: string;
}
export interface ReviewInput extends DocumentInput {
  spec_version: string;
  checklist_sha256: string;
}

function validate(input: DocumentInput) {
  normalizeName(input.name);
  nonblank(input.summary, "summary");
  nonblank(input.content, "content");
}

export async function writeSpec(project: Project, input: DocumentInput, initial: boolean) {
  validate(input);
  return mutate(project, async (metadata) => {
    let spec: Spec;
    if (initial) {
      if (metadata.specs.some((s) => s.name === input.name))
        throw new Error(`Spec '${input.name}' already exists; use update_spec`);
      const directory = normalizeName(input.name);
      if (metadata.specs.some((s) => s.directory === directory))
        throw new Error(`Spec name collides with an existing directory: ${directory}`);
      spec = {
        name: input.name,
        directory,
        file_base: "spec",
        versions: [],
        version_summaries: {},
        checklist: null,
        review: null,
        decision: null,
      };
      metadata.specs.push(spec);
    } else {
      spec = findSpec(metadata, input.name);
      assertOpen(spec);
      if (!(await readOptional(specPath(project, spec))))
        throw new Error("Latest spec file is missing; restore it before updating");
    }
    const version = `v${spec.versions.length + 1}`;
    spec.versions.push(version);
    spec.version_summaries[version] = input.summary;
    const path = specPath(project, spec);
    return {
      result: { path, version, summary: input.summary, sha256: sha256(Buffer.from(input.content)) },
      changes: [
        {
          path: `${spec.directory}/spec-${version}.md`,
          content: input.content,
          mode: 0o444,
          create: true,
        },
      ],
    };
  });
}

export async function writeArtifact(
  project: Project,
  input: DocumentInput | ReviewInput,
  kind: "checklist" | "review",
) {
  validate(input);
  return mutate(project, async (metadata) => {
    const spec = findSpec(metadata, input.name);
    assertOpen(spec);
    if (kind === "review") {
      const review = input as ReviewInput;
      if (!spec.versions.includes(review.spec_version))
        throw new Error("Review spec_version must identify an existing version");
      if (!/^[a-f0-9]{64}$/.test(review.checklist_sha256))
        throw new Error("Review checklist_sha256 must be a SHA-256 fingerprint");
      if (
        !spec.checklist ||
        !(await readOptional(join(project.specs, spec.directory, "checklist.md")))
      )
        throw new Error("Write the canonical checklist before writing a review");
    }
    const digest = sha256(Buffer.from(input.content));
    const file = `${kind}.md`;
    if (kind === "checklist")
      spec.checklist = { file: "checklist.md", summary: input.summary, sha256: digest };
    else {
      const review = input as ReviewInput;
      spec.review = {
        file: "review.md",
        summary: input.summary,
        sha256: digest,
        spec_version: review.spec_version,
        checklist_sha256: review.checklist_sha256,
      };
    }
    return {
      result: {
        path: join(project.specs, spec.directory, file),
        summary: input.summary,
        sha256: digest,
      },
      changes: [{ path: `${spec.directory}/${file}`, content: input.content, mode: 0o600 }],
    };
  });
}
