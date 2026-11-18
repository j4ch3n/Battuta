import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ProjectsFixture {
  home: string;
  projectsRoot: string;
  atlasCode: string;
  atlasWorktree: string;
  bravoCode: string;
  bravoWorktree: string;
  dispose(): Promise<void>;
}

function git(args: string[], cwd: string): string {
  return execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8" },
  );
}

/**
 * A temporary home with two registered projects (`atlas`, `bravo`). Each has a project.yaml and a real git
 * repository under `code/`, and one linked worktree outside the projects folder. Real git, no mocks.
 */
export async function createProjectsFixture(): Promise<ProjectsFixture> {
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "delegation-cwd-")));
  const projectsRoot = join(home, ".battuta", "projects");
  const paths: Record<string, string> = {};
  for (const name of ["atlas", "bravo"]) {
    const project = join(projectsRoot, name);
    const code = join(project, "code");
    await fs.mkdir(code, { recursive: true });
    await fs.writeFile(join(project, "project.yaml"), `name: ${name}\n`);
    git(["init", "-q", "--initial-branch=main"], code);
    await fs.writeFile(join(code, "README.md"), `${name}\n`);
    git(["add", "README.md"], code);
    git(["commit", "-q", "-m", "init"], code);
    const worktree = join(home, "worktrees", `${name}-fis-179`);
    await fs.mkdir(join(home, "worktrees"), { recursive: true });
    git(["worktree", "add", "-q", "-b", `${name}-fis-179`, worktree], code);
    paths[`${name}Code`] = await fs.realpath(code);
    paths[`${name}Worktree`] = await fs.realpath(worktree);
  }
  return {
    home,
    projectsRoot,
    atlasCode: paths.atlasCode,
    atlasWorktree: paths.atlasWorktree,
    bravoCode: paths.bravoCode,
    bravoWorktree: paths.bravoWorktree,
    dispose: () => fs.rm(home, { recursive: true, force: true }),
  };
}
