import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveBinding } from "../binding.ts";
test("binding uses registered slug rather than checkout path, rejecting symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "binding-test-"));
  try {
    expect(await resolveBinding(root)).toBeNull();
    await mkdir(join(root, "atlas/code"), { recursive: true });
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "atlas" }));
    await writeFile(
      join(root, "atlas/project.yaml"),
      `version: 1\nproject:\n  name: atlas\n  path: ${root}/atlas/code\n`,
    );
    expect(await resolveBinding(root)).toBe("atlas");
    await symlink(join(root, "atlas"), join(root, "alias"));
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "alias" }));
    await expect(resolveBinding(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
