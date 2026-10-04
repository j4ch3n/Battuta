import assert from "node:assert/strict";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { atomicWrite, directory, readOptional, setMode } from "../store/files.ts";
import { fixture } from "./fixtures.ts";

test.each(["read", "write", "mode", "directory"])(
  "managed %s rejects a symlink hidden in an ancestor directory",
  async (operation) => {
    const f = await fixture();
    try {
      const parent = join(f.root, "regular");
      await mkdir(join(parent, "nested"), { recursive: true });
      const original = join(parent, "nested/document.md");
      await writeFile(original, "Original", { mode: 0o600 });
      const alias = join(f.root, "alias");
      await symlink(parent, alias);
      const path = join(alias, "nested/document.md");
      const operations = {
        read: () => readOptional(path),
        write: () => atomicWrite(path, "Replacement"),
        mode: () => setMode(path, 0o444),
        directory: () => directory(join(alias, "nested")),
      };
      await assert.rejects(operations[operation as keyof typeof operations](), /symlink.*copy/i);
      assert.equal(await readFile(original, "utf8"), "Original");
      assert.equal((await stat(original)).mode & 0o777, 0o600);
    } finally {
      await f.cleanup();
    }
  },
);

test("managed writes reject a dangling artifact symlink rather than creating its target", async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "missing.md");
    const alias = join(f.root, "alias.md");
    await symlink(target, alias);
    await assert.rejects(atomicWrite(alias, "New content"), /symlink.*copy/i);
    await assert.rejects(stat(target), /ENOENT/);
  } finally {
    await f.cleanup();
  }
});
