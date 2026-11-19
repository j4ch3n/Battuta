import { expect, test } from "vitest";
import { dreamDiagnostic } from "../dream-errors.ts";
import { parseModelJson } from "../model-json.ts";

test.each([['{"a":1}'], ['```json\n{"a":1}\n```'], ["{'a': 1,}"]])(
  "parseModelJson repairs syntax noise %#",
  (text) => {
    expect(parseModelJson(text)).toEqual({ a: 1 });
  },
);

test.each([[""], ["I cannot help with that."], ["42"], ["null"]])(
  "parseModelJson rejects non-object output %#",
  (text) => {
    expect(() => parseModelJson(text)).toThrow(SyntaxError);
  },
);

test("rejected model output is reported as invalid_json", () => {
  try {
    parseModelJson("I cannot help with that.");
  } catch (error) {
    expect(dreamDiagnostic(error, "edit")).toMatchObject({ code: "invalid_json", retryable: true });
    return;
  }
  throw new Error("Expected parse failure");
});
