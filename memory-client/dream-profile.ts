import { z } from "zod";

const section = z
  .string()
  .trim()
  .refine(
    (value) => !/^\s*#/m.test(value) && !value.includes("```"),
    "Profile sections must not introduce headings or code fences",
  );

export const ownerProfileSchema = z
  .object({
    backgroundAndRole: section,
    goalsAndPriorities: section,
    valuesAndDecisionMaking: section,
    lifeContextAndInterests: section,
    enduringPreferencesAndConstraints: section,
  })
  .strict();

export type OwnerProfileSections = z.infer<typeof ownerProfileSchema>;

const headings: Record<keyof OwnerProfileSections, string> = {
  backgroundAndRole: "Background and role",
  goalsAndPriorities: "Goals and priorities",
  valuesAndDecisionMaking: "Values and decision-making",
  lifeContextAndInterests: "Life context and interests",
  enduringPreferencesAndConstraints: "Enduring preferences and constraints",
};

export function renderOwnerProfile(input: unknown): string {
  const sections = ownerProfileSchema.parse(input);
  const parts = ["# About Human Product Owner"];
  for (const key of Object.keys(headings) as (keyof OwnerProfileSections)[]) {
    parts.push(`## ${headings[key]}`);
    if (sections[key]) parts.push(sections[key]);
  }
  const profile = parts.join("\n\n") + "\n";
  if (Buffer.byteLength(profile) > 32000) throw new Error("Owner profile exceeds size limit");
  return profile;
}
