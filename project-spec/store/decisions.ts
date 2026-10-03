import { join } from "node:path";
import { nonblank, readOptional, sha256 } from "./files.ts";
import { assertOpen, findSpec, latest, specPath } from "./metadata.ts";
import type { Project } from "./projects.ts";
import { mutate, type Change } from "./transactions.ts";

export interface DecisionInput {
  project: string;
  name: string;
  decision: "go" | "no-go";
  rationale: string;
}

export async function finalize(project: Project, input: DecisionInput) {
  nonblank(input.rationale, "rationale");
  if (!["go", "no-go"].includes(input.decision)) throw new Error("decision must be go or no-go");
  return mutate(project, async (metadata) => {
    const spec = findSpec(metadata, input.name);
    assertOpen(spec);
    const version = latest(spec);
    const bytes = await readOptional(specPath(project, spec));
    if (!bytes) throw new Error("Latest spec file is missing; cannot calculate its hash");
    const recorded = new Date().toISOString();
    const content = `# Product decision: ${input.name}\n\n**Outcome:** ${input.decision}\n**Spec version:** ${version}\n**Recorded:** ${recorded}\n\n## Rationale\n\n${input.rationale}`;
    const checklist = await readOptional(join(project.specs, spec.directory, "checklist.md"));
    const review = await readOptional(join(project.specs, spec.directory, "review.md"));
    const digest = sha256(Buffer.from(content));
    spec.decision = {
      outcome: input.decision,
      spec_version: version,
      recorded_at: recorded,
      file: "decision.md",
      sha256: {
        spec: sha256(bytes),
        checklist: checklist ? sha256(checklist) : null,
        review: review ? sha256(review) : null,
        decision: digest,
      },
    };
    const changes: Change[] = [
      { path: `${spec.directory}/decision.md`, content, mode: 0o444, create: true },
    ];
    for (const file of [
      `spec-${version}.md`,
      ...(checklist ? ["checklist.md"] : []),
      ...(review ? ["review.md"] : []),
    ])
      changes.push({ path: `${spec.directory}/${file}`, mode: 0o444 });
    return {
      result: { path: join(project.specs, spec.directory, "decision.md"), decision: spec.decision },
      changes,
    };
  });
}
