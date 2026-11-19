import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveDelegationCwd, sanitizedGitEnv } from "../delegation-cwd.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

let fixture: ProjectsFixture;
beforeEach(async () => {
  fixture = await createProjectsFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.dispose();
});

const resolve = (project: string, worktree?: string) =>
  resolveDelegationCwd({ project, worktree, projectsRoot: fixture.projectsRoot });

test("without a worktree the cwd is the project's code folder", async () => {
  expect(await resolve("atlas")).toEqual({
    cwd: join(fixture.projectsRoot, "atlas", "code"),
    source: "code-folder",
  });
});

test("a valid worktree of the project's repository replaces the code folder as cwd", async () => {
  expect(await resolve("atlas", fixture.atlasWorktree)).toEqual({
    cwd: fixture.atlasWorktree,
    source: "worktree",
  });
});

test("the code folder of each project is resolved from that project only", async () => {
  expect((await resolve("bravo")).cwd).toBe(join(fixture.projectsRoot, "bravo", "code"));
});

test("a worktree of another project's repository is rejected", async () => {
  await expect(resolve("atlas", fixture.bravoWorktree)).rejects.toThrow(
    `worktree "${fixture.bravoWorktree}" belongs to a different repository than project "atlas"`,
  );
});

test("a worktree placed inside another project's folder is rejected", async () => {
  const inside = join(fixture.projectsRoot, "bravo", "side-atlas");
  await fs.rm(inside, { recursive: true, force: true });
  execFileSync("git", ["worktree", "add", "-q", "-b", "side-atlas", inside], {
    cwd: fixture.atlasCode,
  });
  await expect(resolve("atlas", inside)).rejects.toThrow(
    `worktree "${inside}" lies inside project "bravo" and cannot run for "atlas"`,
  );
});

test("the error names the project and says no default directory is used", async () => {
  const error = await resolve("nosuch").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(
    /^Delegation cannot start: project "nosuch" has no registered folder/,
  );
  expect((error as Error).message).toContain("No default directory is used.");
});

test("a project without a project.yaml cannot resolve a code folder", async () => {
  await fs.rm(join(fixture.projectsRoot, "bravo", "project.yaml"));
  await expect(resolve("bravo")).rejects.toThrow('project "bravo" has no project.yaml');
});

test("a missing code folder fails clearly", async () => {
  await fs.rm(join(fixture.projectsRoot, "bravo", "code"), { recursive: true });
  await expect(resolve("bravo")).rejects.toThrow('project "bravo" code folder');
});

test("a symlinked code folder is never used as cwd", async () => {
  const code = join(fixture.projectsRoot, "bravo", "code");
  await fs.rename(code, join(fixture.home, "moved-code"));
  await fs.symlink(join(fixture.home, "moved-code"), code);
  await expect(resolve("bravo")).rejects.toThrow("must be a real directory, not a symlink");
});

test.each(["", "..", "../atlas", "atlas/../bravo", "/", "/x/../y"])(
  "a project name %j that escapes the projects folder is refused",
  async (project) => {
    await expect(resolve(project)).rejects.toThrow("Delegation cannot start");
  },
);

test.each([
  ["a relative path", "relative/worktree"],
  ["an empty string", ""],
  ["a path with traversal", "/x/../y"],
  ["a path with a trailing separator", "/tmp/worktree/"],
  ["a path with a control character", `${"/tmp/x"}\n`],
])("an invalid worktree (%s) fails before any cwd is returned", async (_label, worktree) => {
  await expect(resolve("atlas", worktree)).rejects.toThrow("Delegation cannot start");
});

test("a worktree that does not exist fails clearly", async () => {
  const missing = join(fixture.home, "worktrees", "missing");
  await expect(resolve("atlas", missing)).rejects.toThrow(
    `worktree "${missing}" for project "atlas" does not exist`,
  );
});

test("a plain directory that is not a git checkout is refused", async () => {
  const plain = join(fixture.home, "plain");
  await fs.mkdir(plain);
  await expect(resolve("atlas", plain)).rejects.toThrow("is not the top of a git checkout");
});

test("a subdirectory of a worktree is not accepted as the worktree", async () => {
  const sub = join(fixture.atlasWorktree, "README.md");
  await expect(resolve("atlas", sub)).rejects.toThrow("is not a directory");
  const dir = join(fixture.atlasWorktree, "nested");
  await fs.mkdir(dir);
  await expect(resolve("atlas", dir)).rejects.toThrow("is not the top of a git checkout");
});

test("a symlink to a valid worktree is refused", async () => {
  const link = join(fixture.home, "link-to-worktree");
  await fs.symlink(fixture.atlasWorktree, link);
  await expect(resolve("atlas", link)).rejects.toThrow("must not be a symbolic link");
});

test("a code folder that is not a git checkout cannot validate a worktree", async () => {
  const code = join(fixture.projectsRoot, "bravo", "code");
  await fs.rm(join(code, ".git"), { recursive: true, force: true });
  await expect(resolve("bravo", fixture.bravoWorktree)).rejects.toThrow(
    'code folder of project "bravo" is not a git checkout',
  );
});

test("the git checks ignore GIT_* variables that redirect them to another repository", async () => {
  const bravoGit = join(fixture.bravoCode, ".git");
  vi.stubEnv("GIT_DIR", bravoGit);
  vi.stubEnv("GIT_COMMON_DIR", bravoGit);
  vi.stubEnv("GIT_WORK_TREE", fixture.bravoCode);
  vi.stubEnv("GIT_INDEX_FILE", join(bravoGit, "index"));
  expect(await resolve("atlas", fixture.atlasWorktree)).toEqual({
    cwd: fixture.atlasWorktree,
    source: "worktree",
  });
});

test("sanitizedGitEnv removes every GIT_ variable and keeps the rest", () => {
  expect(
    sanitizedGitEnv({ PATH: "/bin", HOME: "/home/w", GIT_DIR: "/x", GIT_COMMON_DIR: "/y" }),
  ).toEqual({ PATH: "/bin", HOME: "/home/w" });
});
