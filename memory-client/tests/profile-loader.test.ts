import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readOwnerProfile, readValidatedProfile } from "../profile-loader.ts";
import { record } from "./fixtures/record.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
test("CoS reads exact existing bytes and Manager does not load the profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-test-"));
  dirs.push(dir);
  const content = "# About me\n\nLikes concise answers.\n";
  await writeFile(join(dir, "ME.md"), content);
  expect(await readOwnerProfile(dir)).toBe(content);
  expect(await readValidatedProfile(dir, [], new Date())).toBe("");
  expect(await readFile(join(dir, "ME.md"), "utf8")).toBe(content);
});

test("profile claims vanish when evidence expires or changes; raw owner text stays private", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-evidence-"));
  dirs.push(dir);
  const r = record();
  await writeFile(
    join(dir, "dream-profile.json"),
    JSON.stringify({
      claims: [
        {
          text: "Reported console purchase",
          evidence: [{ ref: r.ref, revision: r.revision }],
          knowledge_type: "fact",
          confidence: "confirmed",
        },
      ],
    }),
  );
  expect(await readValidatedProfile(dir, [r], new Date())).toContain("Reported console purchase");
  expect(await readValidatedProfile(dir, [{ ...r, revision: "b".repeat(64) }], new Date())).toBe(
    "",
  );
  expect(
    await readValidatedProfile(
      dir,
      [{ ...r, memory_metadata: { ...r.memory_metadata!, expires_at: "2020-01-01T00:00:00Z" } }],
      new Date(),
    ),
  ).toBe("");
});
test("missing profile is optional, oversized and unreadable profiles are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-test-"));
  dirs.push(dir);
  expect(await readOwnerProfile(dir)).toBeUndefined();
  await writeFile(join(dir, "ME.md"), "x".repeat(32001));
  await expect(readOwnerProfile(dir)).rejects.toThrow("size");
  await expect(readOwnerProfile(join(dir, "ME.md"))).rejects.toThrow();
});
