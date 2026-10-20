import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readOwnerProfile, profilePrompt } from "../profile-loader.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
test("PM reads exact existing bytes and TL does not load the profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-test-"));
  dirs.push(dir);
  const content = "# About me\n\nLikes concise answers.\n";
  await writeFile(join(dir, "ME.md"), content);
  expect(await readOwnerProfile(dir)).toBe(content);
  expect(await profilePrompt("tl", "/does/not/exist")).toBeUndefined();
  expect(await profilePrompt("pm", dir)).toContain(content);
  expect(await readFile(join(dir, "ME.md"), "utf8")).toBe(content);
});
test("missing profile is optional, oversized and unreadable profiles are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-test-"));
  dirs.push(dir);
  expect(await readOwnerProfile(dir)).toBeUndefined();
  await writeFile(join(dir, "ME.md"), "x".repeat(32001));
  await expect(readOwnerProfile(dir)).rejects.toThrow("size");
  await expect(readOwnerProfile(join(dir, "ME.md"))).rejects.toThrow();
});
