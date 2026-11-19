import { jsonrepair } from "jsonrepair";

// Models sometimes wrap JSON in code fences or use single quotes and trailing
// commas. Repair only fixes syntax; callers still validate the schema.
export function parseModelJson(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(jsonrepair(text));
  } catch {
    throw new SyntaxError("Model output is not JSON");
  }
  // Repair turns plain prose into a JSON string: that is not structured output.
  if (typeof value !== "object" || value === null)
    throw new SyntaxError("Model output is not JSON");
  return value;
}
