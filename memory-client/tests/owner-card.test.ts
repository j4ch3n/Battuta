import { expect, test } from "vitest";
import { MemoryError } from "../mcp-client.ts";
import { ownerCard, PROJECT_HINT } from "../owner-card.ts";
import { fakeMemory } from "./fake-memory.ts";

const signal = new AbortController().signal;

test("renders the owner overview and one line per project", async () => {
  const { client, calls } = fakeMemory({
    memory_profile: { status: "ok", body: "Jason Chen, founder and CEO of Fiscum." },
    memory_project_descriptions: {
      descriptions: { mocktest: "Mobile banking prototype for Acme", battuta: null },
    },
  });
  expect(await ownerCard(client, ["battuta", "mocktest"], signal)).toBe(
    [
      "# Owner",
      "Jason Chen, founder and CEO of Fiscum.",
      "",
      "## Projects",
      "- battuta — (no description yet)",
      "- mocktest — Mobile banking prototype for Acme",
      PROJECT_HINT,
    ].join("\n"),
  );
  expect(calls[1]).toEqual(["memory_project_descriptions", { projects: ["battuta", "mocktest"] }]);
});

test("says so before the first dream", async () => {
  const { client } = fakeMemory({
    memory_profile: { status: "not_written" },
    memory_project_descriptions: { descriptions: {} },
  });
  const card = await ownerCard(client, [], signal);
  expect(card).toContain("No owner profile yet.");
  expect(card).toContain("- (none yet)");
});

test.each([new MemoryError("backend_unavailable", "down"), new TypeError("fetch failed")])(
  "degrades on a failed query",
  async (error) => {
    const { client } = fakeMemory({ memory_profile: error });
    expect(await ownerCard(client, ["mocktest"], signal)).toBe(
      `Owner profile unavailable: memory query failed. Projects: mocktest. ${PROJECT_HINT}`,
    );
  },
);
