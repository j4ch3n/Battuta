import { z } from "zod";
import { renderOwnerProfile } from "./dream-profile.ts";
import { type MemoryRecord } from "./dream-mutations.ts";
import { redact } from "./privacy.ts";

const statements = z
  .array(
    z
      .object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .refine((v) => redact(v) === v),
        source_refs: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(100),
      })
      .strict(),
  )
  .max(50);
export const personalProfileSchema = z
  .object({
    sections: z
      .object({
        backgroundAndRole: statements,
        goalsAndPriorities: statements,
        valuesAndDecisionMaking: statements,
        lifeContextAndInterests: statements,
        enduringPreferencesAndConstraints: statements,
      })
      .strict(),
  })
  .strict();
export type PersonalProfile = z.infer<typeof personalProfileSchema> & { content: string };

export function validatePersonalProfile(
  input: unknown,
  records: MemoryRecord[],
  previousContent: string,
  previous: PersonalProfile | undefined,
  trackedStatements: string[] = [],
): PersonalProfile {
  const { sections } = personalProfileSchema.parse(input);
  const globalRefs = new Set(records.filter((r) => r.scope.global).map((r) => r.ref));
  // Editing unrelated bytes must never detach previously tracked understanding.
  const prior = previous ? Object.values(previous.sections).flat() : [];
  const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
  const blocks = previousContent.split(/\n\s*\n/).map(normalized);
  for (const statement of Object.values(sections).flat()) {
    const text = normalized(statement.text);
    const overlapsTracked = [
      ...prior.filter((s) => s.source_refs.length > 0).map((s) => s.text),
      ...trackedStatements,
    ].some((s) => normalized(s).includes(text) || text.includes(normalized(s)));
    const inherited = !overlapsTracked && blocks.includes(text);
    if (
      statement.source_refs.length
        ? statement.source_refs.some((r) => !globalRefs.has(r))
        : !inherited
    )
      throw new Error("Unsupported personal evidence");
  }
  const content = renderOwnerProfile(
    Object.fromEntries(
      Object.entries(sections).map(([key, values]) => [
        key,
        values.map((v) => v.text).join("\n\n"),
      ]),
    ),
  );
  return { sections, content };
}
