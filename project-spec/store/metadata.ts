import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { join } from "node:path";
import { directory, readOptional, nonblank } from "./files.ts";
import type { Project } from "./projects.ts";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const version = Type.String({ pattern: "^v[1-9][0-9]*$" });
const nullable = <T extends import("typebox").TSchema>(schema: T) =>
  Type.Union([schema, Type.Null()]);
const object = <T extends import("typebox").TProperties>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });

export const SpecSchema = object({
  name: text,
  directory: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  file_base: Type.Literal("spec"),
  versions: Type.Array(version, { minItems: 1, uniqueItems: true }),
  version_summaries: Type.Record(Type.String({ pattern: "^v[1-9][0-9]*$" }), text),
  checklist: nullable(object({ file: Type.Literal("checklist.md"), summary: text, sha256: hash })),
  review: nullable(
    object({
      file: Type.Literal("review.md"),
      summary: text,
      sha256: hash,
      spec_version: version,
      checklist_sha256: hash,
    }),
  ),
  decision: nullable(
    object({
      outcome: Type.Union([Type.Literal("go"), Type.Literal("no-go")]),
      spec_version: version,
      recorded_at: text,
      file: Type.Literal("decision.md"),
      sha256: object({
        spec: hash,
        checklist: nullable(hash),
        decision: hash,
        review: nullable(hash),
      }),
    }),
  ),
});
export const MetadataSchema = object({
  schema_version: Type.Literal(1),
  specs: Type.Array(SpecSchema),
});
export type Metadata = Static<typeof MetadataSchema>;
export type Spec = Static<typeof SpecSchema>;
export const emptyMetadata = (): Metadata => ({ schema_version: 1, specs: [] });
export const latest = (spec: Spec) => spec.versions[spec.versions.length - 1];
export const specPath = (project: Project, spec: Spec, version = latest(spec)) =>
  join(project.specs, spec.directory, `spec-${version}.md`);

export function normalizeName(name: string) {
  nonblank(name, "name");
  if (name !== name.trim() || /[/\\\0]/.test(name))
    throw new Error("Spec name must be trimmed text, not a path");
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) throw new Error("Spec name must contain letters or numbers");
  return normalized;
}

export function parseMetadata(bytes: Buffer | string): Metadata {
  let input: unknown;
  try {
    input = JSON.parse(
      typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("Invalid spec metadata JSON");
  }
  if (!Value.Check(MetadataSchema, input)) throw new Error("Invalid spec metadata schema");
  const names = new Set<string>();
  const directories = new Set<string>();
  for (const spec of input.specs) {
    if (spec.decision) {
      const date = new Date(spec.decision.recorded_at);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== spec.decision.recorded_at) {
        throw new Error("Invalid decision timestamp in spec metadata");
      }
    }
    if (
      names.has(spec.name) ||
      directories.has(spec.directory) ||
      normalizeName(spec.name) !== spec.directory ||
      spec.versions.some((v, i) => v !== `v${i + 1}` || !spec.version_summaries[v]) ||
      Object.keys(spec.version_summaries).length !== spec.versions.length ||
      (spec.review && !spec.versions.includes(spec.review.spec_version)) ||
      (spec.decision && spec.decision.spec_version !== latest(spec))
    )
      throw new Error("Inconsistent spec metadata");
    names.add(spec.name);
    directories.add(spec.directory);
  }
  return input;
}

export async function readMetadata(project: Project): Promise<Metadata> {
  if (!(await directory(project.specs, true))) return emptyMetadata();
  const bytes = await readOptional(join(project.specs, "index.json"));
  return bytes ? parseMetadata(bytes) : emptyMetadata();
}

export function findSpec(metadata: Metadata, name: string): Spec {
  normalizeName(name);
  const spec = metadata.specs.find((s) => s.name === name);
  if (!spec) throw new Error(`Spec '${name}' not found`);
  return spec;
}

export function assertOpen(spec: Spec) {
  if (spec.decision)
    throw new Error(
      `Spec '${spec.name}' finalized as ${spec.decision.outcome.toUpperCase()} at ${spec.decision.spec_version}; it cannot be changed. Use describe_spec to inspect its status.`,
    );
}
