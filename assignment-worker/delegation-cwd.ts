import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs `git` in a directory and returns stdout; rejects when git fails. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

/**
 * The worker's environment without any `GIT_*` variable. Those (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
 * GIT_COMMON_DIR, ...) can redirect the checks to another repository, so the git checks never inherit them.
 */
export function sanitizedGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}

export const runGit: GitRunner = async (args, cwd) =>
  (
    await execFileAsync("git", args, {
      cwd,
      timeout: 10_000,
      env: sanitizedGitEnv(process.env),
    })
  ).stdout;

const PREFIX = "Delegation cannot start";

function refuse(reason: string): never {
  throw new Error(`${PREFIX}: ${reason}. No default directory is used.`);
}

/** The same project-name rule as project-context-cli (`project_name`): a direct, nonhidden folder name. */
function assertProjectName(project: string) {
  if (!/\S/u.test(project) || project.startsWith(".") || /[/\\\p{Cc}]/u.test(project))
    refuse(`project "${project}" is not a valid registered project name`);
}

async function lstatOrNull(path: string) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The project's registered code folder, resolved with the registry rule
 * (project-context-cli `ProjectRegistry.load`): `<projects>/<project>/project.yaml` must be a regular
 * file and `<projects>/<project>/code` a real directory, not a symlink.
 */
export async function resolveCodeFolder(projectsRoot: string, project: string): Promise<string> {
  assertProjectName(project);
  const projectDir = join(projectsRoot, project);
  const info = await lstatOrNull(projectDir);
  if (!info) refuse(`project "${project}" has no registered folder at ${projectDir}`);
  if (info.isSymbolicLink() || !info.isDirectory())
    refuse(`project "${project}" folder ${projectDir} must be a real directory`);
  const config = await lstatOrNull(join(projectDir, "project.yaml"));
  if (!config?.isFile())
    refuse(`project "${project}" has no project.yaml at ${join(projectDir, "project.yaml")}`);
  const code = join(projectDir, "code");
  const codeInfo = await lstatOrNull(code);
  if (!codeInfo) refuse(`project "${project}" code folder ${code} does not exist`);
  if (codeInfo.isSymbolicLink() || !codeInfo.isDirectory())
    refuse(`project "${project}" code folder ${code} must be a real directory, not a symlink`);
  return code;
}

/**
 * Validates a worktree supplied for `project`: an absolute path that resolves to a checkout listed by
 * `git worktree list` in the project's code folder, which also makes it a checkout of the same repository.
 */
async function validateWorktree(
  worktree: string,
  project: string,
  codeFolder: string,
  git: GitRunner,
): Promise<string> {
  if (!isAbsolute(worktree)) refuse(`worktree "${worktree}" must be an absolute path`);
  const real = await fs
    .realpath(worktree)
    .catch(() => refuse(`worktree "${worktree}" for project "${project}" does not exist`));
  const listing = await git(["worktree", "list", "--porcelain"], codeFolder).catch(() =>
    refuse(`git worktree list failed for project "${project}" code folder`),
  );
  const listed = listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  if (!listed.includes(real))
    refuse(`worktree "${worktree}" is not a git worktree of project "${project}"`);
  return real;
}

/**
 * The working directory for a worker-started delegate run: the supplied worktree when one is given and
 * valid, otherwise the project's code folder. Throws before anything starts; never falls back.
 */
export async function resolveDelegationCwd(input: {
  project: string;
  worktree?: string;
  projectsRoot: string;
  git?: GitRunner;
}): Promise<string> {
  const codeFolder = await resolveCodeFolder(input.projectsRoot, input.project);
  if (input.worktree === undefined) return codeFolder;
  return validateWorktree(input.worktree, input.project, codeFolder, input.git ?? runGit);
}
