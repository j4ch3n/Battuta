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
  expect(await resolve("atlas")).toBe(join(fixture.projectsRoot, "atlas", "code"));
});

test("a worktree of the project's repository replaces the code folder as cwd", async () => {
  expect(await resolve("atlas", fixture.atlasWorktree)).toBe(fixture.atlasWorktree);
});

test("the code folder of each project is resolved from that project only", async () => {
  expect(await resolve("bravo")).toBe(join(fixture.projectsRoot, "bravo", "code"));
});

test("a worktree of another project's repository is rejected", async () => {
  await expect(resolve("atlas", fixture.bravoWorktree)).rejects.toThrow(
    `worktree "${fixture.bravoWorktree}" is not a git worktree of project "atlas"`,
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
])("a worktree given as %s is refused before any cwd is returned", async (_label, worktree) => {
  await expect(resolve("atlas", worktree)).rejects.toThrow("must be an absolute path");
});

test("a worktree that does not exist fails clearly", async () => {
  const missing = join(fixture.home, "worktrees", "missing");
  await expect(resolve("atlas", missing)).rejects.toThrow(
    `worktree "${missing}" for project "atlas" does not exist`,
  );
});

test.each([
  [
    "a plain directory",
    async () => (await fs.mkdir(join(fixture.home, "plain")), join(fixture.home, "plain")),
  ],
  [
    "a subdirectory of a worktree",
    async () => (
      await fs.mkdir(join(fixture.atlasWorktree, "nested")),
      join(fixture.atlasWorktree, "nested")
    ),
  ],
])("%s is not accepted as a worktree", async (_label, make) => {
  const path = await make();
  await expect(resolve("atlas", path)).rejects.toThrow(
    `worktree "${path}" is not a git worktree of project "atlas"`,
  );
});

test("a code folder that is not a git checkout cannot validate a worktree", async () => {
  await fs.rm(join(fixture.bravoCode, ".git"), { recursive: true, force: true });
  await expect(resolve("bravo", fixture.bravoWorktree)).rejects.toThrow(
    'git worktree list failed for project "bravo"',
  );
});

test("the git checks ignore GIT_* variables that redirect them to another repository", async () => {
  const bravoGit = join(fixture.bravoCode, ".git");
  vi.stubEnv("GIT_DIR", bravoGit);
  vi.stubEnv("GIT_COMMON_DIR", bravoGit);
  vi.stubEnv("GIT_WORK_TREE", fixture.bravoCode);
  vi.stubEnv("GIT_INDEX_FILE", join(bravoGit, "index"));
  expect(await resolve("atlas", fixture.atlasWorktree)).toBe(fixture.atlasWorktree);
});

test("sanitizedGitEnv removes every GIT_ variable and keeps the rest", () => {
  expect(
    sanitizedGitEnv({ PATH: "/bin", HOME: "/home/w", GIT_DIR: "/x", GIT_COMMON_DIR: "/y" }),
  ).toEqual({ PATH: "/bin", HOME: "/home/w" });
});
