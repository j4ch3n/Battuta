import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { OwnerProfile } from "../profile/storage.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "profile-test-"));
  directories.push(directory);
  return { directory, profile: new OwnerProfile(directory) };
}
const document = "# About Human Product Owner\n\n## Background and role\n\nEnjoys hiking.\n";

test("missing profile read does not create a profile; atomic write is private and survives reopen", async () => {
  const { directory, profile } = await fixture();
  expect(await profile.read()).toMatchObject({ exists: false, content: "", revision: "missing" });
  await expect(stat(join(directory, "ME.md"))).rejects.toMatchObject({ code: "ENOENT" });
  const saved = await profile.write(document, "missing");
  expect(saved.revision).not.toBe("missing");
  expect(await new OwnerProfile(directory).read()).toEqual(saved);
  expect((await stat(join(directory, "ME.md"))).mode & 0o777).toBe(0o600);
});

test.each([
  "",
  "# Wrong heading\n",
  "```markdown\n" + document + "```",
  document + "x".repeat(33000),
])("invalid profile rewrite leaves the old document unchanged (%#)", async (invalid) => {
  const { profile } = await fixture();
  const saved = await profile.write(document, "missing");
  await expect(profile.write(invalid, saved.revision)).rejects.toThrow();
  expect(await profile.read()).toEqual(saved);
});

test("stale revision or cancellation cannot overwrite a manual edit", async () => {
  const { directory, profile } = await fixture();
  const saved = await profile.write(document, "missing");
  await writeFile(join(directory, "ME.md"), document + "Manual edit.\n");
  await expect(profile.write(document, saved.revision)).rejects.toThrow(/revision/i);
  await expect(
    profile.write(document, (await profile.read()).revision, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(await readFile(join(directory, "ME.md"), "utf8")).toContain("Manual edit");
});

test("concurrent rewrites using the same revision cannot both commit", async () => {
  const { profile } = await fixture();
  const saved = await profile.write(document, "missing");
  const results = await Promise.allSettled([
    profile.write(document + "First.\n", saved.revision),
    profile.write(document + "Second.\n", saved.revision),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});
