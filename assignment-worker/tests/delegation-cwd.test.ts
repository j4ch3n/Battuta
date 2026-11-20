import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FIXED_DIRS,
  preapprovedDirs,
  resolveDelegationCwd,
  sanitizedGitEnv,
} from "../delegation-cwd.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

let fixture: ProjectsFixture;
beforeEach(async () => {
  fixture = await createProjectsFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.dispose();
});

const ASSIGNMENT = "0123abcd";
const resolve = async (project: string, cwd?: string) =>
  (
    await resolveDelegationCwd({
      project,
      assignmentId: ASSIGNMENT,
      cwd,
      projectsRoot: fixture.projectsRoot,
    })
  ).cwd;

test("without cwd the run uses the project's code folder", async () => {
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
    `cwd "${fixture.bravoWorktree}" is not the code folder, a worktree, or the assignment work folder of project "atlas"`,
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
])("a cwd given as %s is refused before any cwd is returned", async (_label, worktree) => {
  await expect(resolve("atlas", worktree)).rejects.toThrow("must be an absolute path");
});

test("a cwd that does not exist fails clearly", async () => {
  const missing = join(fixture.home, "worktrees", "missing");
  await expect(resolve("atlas", missing)).rejects.toThrow(
    `cwd "${missing}" for project "atlas" does not exist`,
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
])("%s is not accepted as cwd", async (_label, make) => {
  const path = await make();
  await expect(resolve("atlas", path)).rejects.toThrow(
    `cwd "${path}" is not the code folder, a worktree, or the assignment work folder of project "atlas"`,
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

test("the bound assignment's work folder is accepted as cwd", async () => {
  expect(await resolve("atlas", fixture.atlasWork)).toBe(fixture.atlasWork);
});

test("another assignment's work folder is refused", async () => {
  const other = join(fixture.projectsRoot, "atlas", "work", "89abcdef");
  await fs.mkdir(other, { recursive: true });
  await expect(resolve("atlas", other)).rejects.toThrow(
    "is not the code folder, a worktree, or the assignment work folder",
  );
});

test("a symlink to another project's code folder is refused", async () => {
  const link = join(fixture.home, "link-to-bravo");
  await fs.symlink(fixture.bravoCode, link);
  await expect(resolve("atlas", link)).rejects.toThrow(
    "is not the code folder, a worktree, or the assignment work folder",
  );
});

test("without cwd the run uses the code folder and still returns the work folder", async () => {
  expect(
    await resolveDelegationCwd({
      project: "atlas",
      assignmentId: ASSIGNMENT,
      projectsRoot: fixture.projectsRoot,
    }),
  ).toEqual({
    cwd: fixture.atlasCode,
    codeFolder: fixture.atlasCode,
    workFolder: fixture.atlasWork,
  });
});

test.each(["", "0123ABCD", "../x", "0123abcd0"])(
  "an assignment id %j that is not 8 lowercase hex digits is refused",
  async (assignmentId) => {
    await expect(
      resolveDelegationCwd({ project: "atlas", assignmentId, projectsRoot: fixture.projectsRoot }),
    ).rejects.toThrow("Delegation cannot start");
  },
);

describe("preapprovedDirs", () => {
  const dirs = async (cwd: string, candidates: string[]) =>
    preapprovedDirs({
      codeFolder: fixture.atlasCode,
      workFolder: fixture.atlasWork,
      cwd,
      candidates,
    });

  test("the code and work folders are always included unless one is the cwd", async () => {
    expect(
      await preapprovedDirs({
        codeFolder: fixture.atlasCode,
        workFolder: fixture.atlasWork,
        cwd: fixture.atlasWorktree,
        candidates: [],
      }),
    ).toEqual([fixture.atlasCode, fixture.atlasWork]);
    expect(
      await preapprovedDirs({
        codeFolder: fixture.atlasCode,
        workFolder: fixture.atlasWork,
        cwd: fixture.atlasCode,
        candidates: [],
      }),
    ).toEqual([fixture.atlasWork]);
  });

  test("a missing candidate is skipped", async () => {
    expect(await dirs(fixture.atlasWorktree, [join(fixture.home, "missing")])).not.toContain(
      join(fixture.home, "missing"),
    );
  });

  test("a symlinked candidate and its target appear once", async () => {
    const target = join(fixture.home, "cache");
    await fs.mkdir(target);
    await fs.symlink(target, join(fixture.home, "cache-link"));
    const result = await dirs(fixture.atlasWorktree, [target, join(fixture.home, "cache-link")]);
    expect(result.filter((dir) => dir === target)).toHaveLength(1);
    expect(result).not.toContain(join(fixture.home, "cache-link"));
  });

  test("the result never contains the cwd", async () => {
    const result = await dirs(fixture.atlasWorktree, [
      fixture.atlasWorktree,
      join(fixture.atlasWorktree, "."),
    ]);
    expect(result).not.toContain(fixture.atlasWorktree);
  });

  test("the fixed list covers the Linux and macOS temp and cache folders", () => {
    expect(FIXED_DIRS("/home/w", 1000)).toEqual(
      expect.arrayContaining([
        "/tmp",
        "/var/tmp",
        "/dev/shm",
        "/run/user/1000",
        "/home/w/.cache",
        "/home/w/.local/share",
        "/home/w/.npm",
        "/private/tmp",
        "/var/folders",
        "/home/w/Library/Caches",
      ]),
    );
  });
});
