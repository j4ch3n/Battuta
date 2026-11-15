import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { ensureAssignmentWorkspace } from "../workspace.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function root() {
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "assignment-workspace-"));
  roots.push(directory);
  return join(directory, ".battuta");
}
const target = { project: "Atlas", assignment_id: "1234abcd" };
test.each(["relative", "/some/../root", "/some/./root", "/some\\root", "/some\nroot"])(
  "rejects unsafe roots without touching the filesystem: %j",
  async (base) => {
    await expect(ensureAssignmentWorkspace(base, target)).rejects.toThrow("Workspace root");
  },
);

test("prepares only assignment scratch directories and preserves bytes across repeats", async () => {
  const base = await root();
  const paths = await ensureAssignmentWorkspace(base, target);
  expect(paths).toEqual({
    directory: join(base, "projects/Atlas/work/1234abcd"),
    notePath: join(base, "projects/Atlas/work/1234abcd/note.md"),
  });
  expect(await fs.readFile(paths.notePath, "utf8")).toBe("");
  const bytes = Buffer.from([0, 255, 10, 65]);
  await fs.writeFile(paths.notePath, bytes);
  await ensureAssignmentWorkspace(base, target);
  expect(await fs.readFile(paths.notePath)).toEqual(bytes);
  expect(await fs.readdir(join(base, "projects/Atlas"))).toEqual(["work"]);
});

test.each(["../escape", ".hidden", "a/b", "a\\b", "a\nb", "", "  "])(
  "rejects unsafe project component %j without creation",
  async (project) => {
    const base = await root();
    await expect(ensureAssignmentWorkspace(base, { ...target, project })).rejects.toThrow();
    await expect(fs.lstat(base)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
test.each(["../escape", "ABCDEF12", "123456789", "1234abcd/extra"])(
  "rejects invalid assignment ID %j",
  async (assignment_id) => {
    await expect(
      ensureAssignmentWorkspace(await root(), { ...target, assignment_id }),
    ).rejects.toThrow();
  },
);
test.each(["root", "ancestor", "leaf"])("rejects a symlink at %s", async (where) => {
  const base = await root();
  const outside = join(base, "..", "outside");
  await fs.mkdir(outside);
  if (where === "root") await fs.symlink(outside, base);
  else {
    const paths = await ensureAssignmentWorkspace(base, target);
    const link = where === "leaf" ? paths.notePath : join(base, "projects/Atlas/work");
    await fs.rm(link, { recursive: true });
    await fs.symlink(outside, link);
  }
  await expect(ensureAssignmentWorkspace(base, target)).rejects.toThrow();
  expect(await fs.readdir(outside)).toEqual([]);
});
test.each(["directory", "note"])("rejects the wrong object type at %s", async (where) => {
  const base = await root();
  const paths = await ensureAssignmentWorkspace(base, target);
  const invalid = where === "note" ? paths.notePath : paths.directory;
  await fs.rm(invalid, { recursive: true });
  if (where === "note") await fs.mkdir(invalid);
  else await fs.writeFile(invalid, "preserve");
  await expect(ensureAssignmentWorkspace(base, target)).rejects.toThrow();
});
test("permission failure does not overwrite existing content", async () => {
  const base = await root();
  const paths = await ensureAssignmentWorkspace(base, target);
  await fs.writeFile(paths.notePath, "preserve");
  vi.spyOn(fs, "open").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
  await expect(ensureAssignmentWorkspace(base, target)).rejects.toThrow("denied");
  expect(await fs.readFile(paths.notePath, "utf8")).toBe("preserve");
});
test("different host roots share only a relative reference, never note contents", async () => {
  const firstRoot = await root(),
    secondRoot = await root();
  const first = await ensureAssignmentWorkspace(firstRoot, target);
  await fs.writeFile(first.notePath, "host-private note");
  const second = await ensureAssignmentWorkspace(secondRoot, target);
  expect(relative(firstRoot, first.notePath)).toBe(relative(secondRoot, second.notePath));
  expect(first.notePath).not.toBe(second.notePath);
  expect(await fs.readFile(second.notePath, "utf8")).toBe("");
});
