import { join, resolve } from "node:path";
import { writeSpec, writeArtifact, type DocumentInput, type ReviewInput } from "./documents.ts";
import { finalize, type DecisionInput } from "./decisions.ts";
import { directory, readOptional, sha256 } from "./files.ts";
import { findSpec, latest, specPath } from "./metadata.ts";
import { defaultProjectsRoot, resolveSpecStorage } from "./storage.ts";
import { inspect, loadMetadata } from "./transactions.ts";

export type Role = "pm" | "tl";
export type ConstitutionInput = Omit<DocumentInput, "name">;
const constitutionName = "Constitution";
export class ProjectSpecStore {
  readonly root: string;
  constructor(
    readonly role: Role,
    root = defaultProjectsRoot(),
  ) {
    if (role !== "pm" && role !== "tl") throw new Error("AGENT_ROLE must be pm or tl");
    this.root = resolve(root);
  }
  private allow(role: Role) {
    if (this.role !== role) throw new Error(`Only ${role.toUpperCase()} can author this artifact`);
  }
  async inspectSpecs(name: string) {
    return loadMetadata(await resolveSpecStorage(this.root, name));
  }
  async describeSpec(projectName: string, name: string, includeContent = false) {
    const project = await resolveSpecStorage(this.root, projectName);
    return inspect(project, async (metadata) => {
      const spec = findSpec(metadata, name);
      await directory(join(project.specs, spec.directory));
      const specBytes = await readOptional(specPath(project, spec));
      const checklist = await readOptional(join(project.specs, spec.directory, "checklist.md"));
      const review = await readOptional(join(project.specs, spec.directory, "review.md"));
      const decision = await readOptional(join(project.specs, spec.directory, "decision.md"));
      const current = Boolean(
        review &&
        spec.review &&
        checklist &&
        spec.review.spec_version === latest(spec) &&
        spec.review.checklist_sha256 === sha256(checklist) &&
        spec.review.sha256 === sha256(review),
      );
      return {
        spec,
        latest_version: latest(spec),
        has_spec: Boolean(specBytes),
        has_checklist: Boolean(checklist),
        has_review: Boolean(review),
        has_decision: Boolean(decision),
        latest_reviewed: current,
        review_status: review ? (current ? "current" : "stale") : "missing",
        fingerprints: {
          spec: specBytes ? sha256(specBytes) : null,
          checklist: checklist ? sha256(checklist) : null,
          review: review ? sha256(review) : null,
          decision: decision ? sha256(decision) : null,
        },
        ...(includeContent
          ? {
              contents: {
                spec: specBytes?.toString("utf8") ?? null,
                checklist: checklist?.toString("utf8") ?? null,
                review: review?.toString("utf8") ?? null,
                decision: decision?.toString("utf8") ?? null,
              },
            }
          : {}),
        paths: {
          versions: spec.versions.map((v) => ({ version: v, path: specPath(project, spec, v) })),
          checklist: join(project.specs, spec.directory, "checklist.md"),
          review: join(project.specs, spec.directory, "review.md"),
          decision: join(project.specs, spec.directory, "decision.md"),
        },
      };
    });
  }
  async initSpec(input: DocumentInput) {
    this.allow("pm");
    return writeSpec(await resolveSpecStorage(this.root, input.project), input, true);
  }
  async readConstitution(project: string) {
    const description = await this.describeSpec(project, constitutionName, true);
    if (!description.has_spec)
      throw new Error("Latest constitution file is missing; restore it before reading");
    const version = description.latest_version;
    return {
      name: constitutionName,
      path: description.paths.versions.find((entry) => entry.version === version)!.path,
      version,
      summary: description.spec.version_summaries[version],
      content: description.contents!.spec!,
      sha256: description.fingerprints.spec!,
      decision: description.spec.decision,
    };
  }
  async initConstitution(input: ConstitutionInput) {
    this.allow("pm");
    const saved = await writeSpec(
      await resolveSpecStorage(this.root, input.project),
      { ...input, name: constitutionName },
      true,
      "update_constitution",
    );
    return { name: constitutionName, ...saved };
  }
  async updateConstitution(input: ConstitutionInput) {
    const saved = await this.updateSpec({ ...input, name: constitutionName });
    return { name: constitutionName, ...saved };
  }
  async updateSpec(input: DocumentInput) {
    this.allow("pm");
    return writeSpec(await resolveSpecStorage(this.root, input.project), input, false);
  }
  async writeChecklist(input: DocumentInput) {
    this.allow("tl");
    return writeArtifact(await resolveSpecStorage(this.root, input.project), input, "checklist");
  }
  async writeReview(input: ReviewInput) {
    this.allow("tl");
    return writeArtifact(await resolveSpecStorage(this.root, input.project), input, "review");
  }
  async finalizeSpec(input: DecisionInput) {
    this.allow("pm");
    return finalize(await resolveSpecStorage(this.root, input.project), input);
  }
}
