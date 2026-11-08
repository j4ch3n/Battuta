import { expect, test } from "vitest";
import { prepareCorrectionCandidates } from "../correction-candidates.ts";
import { record } from "./fixtures/record.ts";

test("correction evidence stays bounded and cannot borrow foreign project scope", async () => {
  const candidates = Array.from({ length: 50 }, (_, i) => ({
    ...record(i.toString(16).padStart(64, "0")),
    content: `Attributed event ${i}`,
  }));
  const foreign = { ...record("e".repeat(64)), projects: ["beacon"] };
  const values = await prepareCorrectionCandidates(
    ["atlas", "global"],
    "correction",
    {
      call: (_name, args) => {
        expect(args).toMatchObject({
          selector: "projects",
          projects: ["atlas"],
          include_expired: true,
        });
        return Promise.resolve({
          records: [candidates[0]],
          validation_evidence: [...candidates, foreign],
        });
      },
    },
    new AbortController().signal,
  );
  expect(values).toHaveLength(40);
  expect(values.some((r) => r.ref === foreign.ref)).toBe(false);
});

test("empty source needs no correction search", async () => {
  expect(
    await prepareCorrectionCandidates(
      ["global"],
      " ",
      {
        call: () => {
          throw new Error("must not query");
        },
      },
      new AbortController().signal,
    ),
  ).toEqual([]);
});

test("correction candidates span catalog projects and compare lowercase server memberships", async () => {
  const shared = { ...record(), projects: ["atlas", "beacon"] };
  const candidates = await prepareCorrectionCandidates(
    ["Atlas", "Beacon", "global"],
    "shared database",
    {
      call: (_name, args) => {
        expect(args).toMatchObject({
          semantic_query: "shared database",
          selector: "projects",
          projects: ["Atlas", "Beacon"],
        });
        return Promise.resolve({ records: [shared], validation_evidence: [] });
      },
    },
    new AbortController().signal,
  );
  expect(candidates).toEqual([shared]);
});
