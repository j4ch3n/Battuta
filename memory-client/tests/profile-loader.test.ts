import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readOwnerProfile } from "../profile-loader.ts";
test("shared profile is optional, bounded, and read without changing private bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-"));
  try {
    expect(await readOwnerProfile(dir)).toBeUndefined();
    await writeFile(join(dir, "ME.md"), "# Owner\nConcise replies.\n");
    expect(await readOwnerProfile(dir)).toBe("# Owner\nConcise replies.\n");
    expect(await readFile(join(dir, "ME.md"), "utf8")).toBe("# Owner\nConcise replies.\n");
    await writeFile(join(dir, "ME.md"), "遊".repeat(11000));
    await expect(readOwnerProfile(dir)).rejects.toThrow("size limit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
