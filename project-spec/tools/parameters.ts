import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const text = (description: string) =>
  Type.String({ minLength: 1, pattern: "\\S", description });
export const target = {
  project: text("Exact registered project name."),
  name: text("Spec display name, such as API Design."),
};
export const DocumentParameters = Type.Object(
  {
    ...target,
    summary: text("Short summary of this complete document."),
    content: text("Full Markdown content; never a patch or append."),
  },
  { additionalProperties: false },
);

export function argumentsFor<T extends TSchema>(schema: T, input: unknown): Static<T> {
  if (!Value.Check(schema, input))
    throw new Error(`Invalid tool arguments: ${JSON.stringify([...Value.Errors(schema, input)])}`);
  return input;
}

export const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: value,
});
