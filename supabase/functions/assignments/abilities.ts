import { z } from "zod";
import source from "./abilities.json" with { type: "json" };

export const abilityCatalog = z
  .record(z.string(), z.object({ description: z.string(), tools: z.array(z.string()) }))
  .parse(source);
export const abilityProposal = z
  .array(z.string())
  .transform((values) => [...new Set(values)])
  .describe(
    `Specialist names: ${Object.keys(abilityCatalog).join(", ") || "none; use [] for general work"}. Exact matches only.`,
  );

export function unknownAbilities(values: string[]) {
  const unknown = values.filter((name) => !Object.hasOwn(abilityCatalog, name));
  if (!unknown.length) return undefined;
  return {
    ok: false as const,
    code: "unknown_abilities" as const,
    message: `Unknown specialist abilities: ${unknown.join(", ")}. ${
      Object.keys(abilityCatalog).length
        ? "Choose exact names from the tool's specialist catalog."
        : "The specialist catalog is empty; only [] is currently valid for general work."
    } Nothing was changed.`,
    unknown,
    suggestions: {},
  };
}
