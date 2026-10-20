import { expect, test } from "vitest";
import { validatePersonalProfile } from "../dream-personal.ts";
import { memoryRecordSchema } from "../dream-mutations.ts";

const ref = "a".repeat(64);
const sections = {
  backgroundAndRole: [],
  goalsAndPriorities: [],
  valuesAndDecisionMaking: [],
  lifeContextAndInterests: [],
  enduringPreferencesAndConstraints: [{ text: "Prefers concise replies.", source_refs: [ref] }],
};
const global = memoryRecordSchema.parse({
  ref,
  revision: ref,
  content: "Prefers concise replies.",
  scope: { global: true, projects: [] },
  kind: "preference",
  tags: [],
  sources: [],
  active: true,
});

test("renders cited high-level personal understanding with external evidence", () => {
  const result = validatePersonalProfile({ sections }, [global], "", undefined);
  expect(result.content).toContain(
    "## Enduring preferences and constraints\n\nPrefers concise replies.",
  );
  expect(result.sections.enduringPreferencesAndConstraints[0].source_refs).toEqual([ref]);
});

test("rejects project facts and forgotten personal sources", () => {
  expect(() =>
    validatePersonalProfile(
      { sections },
      [{ ...global, scope: { global: false, projects: ["atlas"] } }],
      "",
      undefined,
    ),
  ).toThrow("personal evidence");
  expect(() => validatePersonalProfile({ sections }, [], "", undefined)).toThrow(
    "personal evidence",
  );
});

test("retains preexisting private understanding but cannot launder invalidated citations", () => {
  const input = {
    sections: {
      ...sections,
      enduringPreferencesAndConstraints: [{ text: "Prefers concise replies.", source_refs: [] }],
    },
  };
  expect(
    validatePersonalProfile(input, [], "Prefers concise replies.", undefined).content,
  ).toContain("Prefers concise replies.");
  expect(() =>
    validatePersonalProfile(input, [], "Prefers concise replies.", {
      content: "Prefers concise replies.",
      sections,
    }),
  ).toThrow("personal evidence");
  const shortened = {
    sections: {
      ...sections,
      enduringPreferencesAndConstraints: [{ text: "concise replies", source_refs: [] }],
    },
  };
  expect(() =>
    validatePersonalProfile(shortened, [], "Prefers concise replies.", {
      content: "Prefers concise replies.",
      sections,
    }),
  ).toThrow("personal evidence");
  expect(() => validatePersonalProfile(input, [], "", undefined)).toThrow("personal evidence");
});

test.each(["\n", "\n\nUser-authored unrelated addition."])(
  "keeps tracked evidence after unrelated edit %j",
  (edit) => {
    const previous = validatePersonalProfile({ sections }, [global], "", undefined);
    for (const text of ["Prefers concise replies.", "concise replies"]) {
      expect(() =>
        validatePersonalProfile(
          {
            sections: {
              ...sections,
              enduringPreferencesAndConstraints: [{ text, source_refs: [] }],
            },
          },
          [],
          previous.content + edit,
          previous,
        ),
      ).toThrow("personal evidence");
    }
  },
);

test("inherits whole user-authored additions without allowing arbitrary substrings", () => {
  const previous = validatePersonalProfile({ sections }, [global], "", undefined);
  const current = previous.content + "\nUser writes poetry.\n";
  const input = {
    sections: {
      ...sections,
      enduringPreferencesAndConstraints: [{ text: "User writes poetry.", source_refs: [] }],
    },
  };
  expect(validatePersonalProfile(input, [], current, previous).content).toContain(
    "User writes poetry.",
  );
  expect(() =>
    validatePersonalProfile(
      {
        sections: {
          ...sections,
          enduringPreferencesAndConstraints: [{ text: "writes poetry", source_refs: [] }],
        },
      },
      [],
      current,
      previous,
    ),
  ).toThrow("personal evidence");
});
