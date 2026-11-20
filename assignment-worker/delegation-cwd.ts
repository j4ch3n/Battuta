import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
 * Validates a `cwd` supplied for `project`: an absolute path that resolves to the assignment's work folder, or to
 * a checkout listed by `git worktree list` in the project's code folder (which includes the code folder itself).
 */
async function validateCwd(
  cwd: string,
  project: string,
  codeFolder: string,
  workFolder: string,
  git: GitRunner,
): Promise<string> {
  if (!isAbsolute(cwd)) refuse(`cwd "${cwd}" must be an absolute path`);
  const real = await fs
    .realpath(cwd)
    .catch(() => refuse(`cwd "${cwd}" for project "${project}" does not exist`));
  if (real === (await fs.realpath(workFolder).catch(() => undefined))) return real;
  const listing = await git(["worktree", "list", "--porcelain"], codeFolder).catch(() =>
    refuse(`git worktree list failed for project "${project}" code folder`),
  );
  const listed = listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  if (!listed.includes(real))
    refuse(
      `cwd "${cwd}" is not the code folder, a worktree, or the assignment work folder of project "${project}"`,
    );
  return real;
}

/**
 * The working directory for a worker-started delegate run: the supplied `cwd` when it is the assignment's work
 * folder or a worktree of the project, otherwise the project's code folder. Throws before anything starts; never
 * falls back. The code and work folders are returned for the run's pre-approved directories.
 */
export async function resolveDelegationCwd(input: {
  project: string;
  assignmentId: string;
  cwd?: string;
  projectsRoot: string;
  git?: GitRunner;
}): Promise<{ cwd: string; codeFolder: string; workFolder: string }> {
  // The same assignment id rule as workspace.ts, so the work folder is a direct child of `work/`.
  if (!/^[0-9a-f]{8}$/.test(input.assignmentId))
    refuse(`assignment id "${input.assignmentId}" is not valid`);
  const codeFolder = await resolveCodeFolder(input.projectsRoot, input.project);
  const workFolder = join(input.projectsRoot, input.project, "work", input.assignmentId);
  const cwd =
    input.cwd === undefined
      ? codeFolder
      : await validateCwd(input.cwd, input.project, codeFolder, workFolder, input.git ?? runGit);
  return { cwd, codeFolder, workFolder };
}

/** Temp and cache folders Claude Code and the tools it runs commonly write to, on Linux hosts and macOS. */
export const FIXED_DIRS = (home: string, uid: number): string[] => [
  tmpdir(),
  "/tmp",
  "/var/tmp",
  "/dev/shm",
  `/run/user/${uid}`,
  join(home, ".cache"),
  join(home, ".local", "share"),
  join(home, ".npm"),
  "/private/tmp",
  "/var/folders",
  join(home, "Library", "Caches"),
];

/**
 * The extra directories a run may use without asking: the project's code and work folders and the fixed temp
 * and cache folders, resolved through symlinks. Missing entries, duplicates and the run's own cwd are left out.
 */
export async function preapprovedDirs(input: {
  codeFolder: string;
  workFolder: string;
  cwd: string;
  home?: string;
  uid?: number;
  candidates?: string[];
}): Promise<string[]> {
  const candidates =
    input.candidates ?? FIXED_DIRS(input.home ?? homedir(), input.uid ?? process.getuid!());
  const cwd = await fs.realpath(input.cwd);
  const dirs: string[] = [];
  for (const dir of [input.codeFolder, input.workFolder, ...candidates]) {
    const real = await fs.realpath(dir).catch(() => undefined);
    if (real && real !== cwd && !dirs.includes(real)) dirs.push(real);
  }
  return dirs;
}
