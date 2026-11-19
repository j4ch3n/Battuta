import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
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

export interface DelegationCwd {
  cwd: string;
  source: "code-folder" | "worktree";
}

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

async function gitLine(args: string[], cwd: string, git: GitRunner): Promise<string> {
  return (await git(args, cwd)).trim();
}

/**
 * Validates an explicitly supplied worktree for `project`. It must be an absolute real directory, the
 * top of a git checkout, a checkout of the same repository as the project's code folder, and listed by
 * `git worktree list` there. A worktree inside another registered project's folder is refused.
 */
async function validateWorktree(
  worktree: string,
  project: string,
  codeFolder: string,
  projectsRoot: string,
  git: GitRunner,
): Promise<string> {
  if (!isAbsolute(worktree) || /\p{Cc}/u.test(worktree))
    refuse(`worktree "${worktree}" must be an absolute path`);
  if (resolve(worktree) !== worktree)
    refuse(`worktree "${worktree}" must not contain "." or ".." segments or a trailing separator`);
  const info = await lstatOrNull(worktree);
  if (!info) refuse(`worktree "${worktree}" for project "${project}" does not exist`);
  if (info.isSymbolicLink()) refuse(`worktree "${worktree}" must not be a symbolic link`);
  if (!info.isDirectory()) refuse(`worktree "${worktree}" is not a directory`);
  const real = await fs.realpath(worktree);
  if (real !== worktree)
    refuse(`worktree "${worktree}" must be given by its real path (it resolves to ${real})`);

  for (const entry of await fs.readdir(projectsRoot, { withFileTypes: true })) {
    if (entry.name === project || !entry.isDirectory()) continue;
    const other = join(projectsRoot, entry.name);
    if (worktree === other || worktree.startsWith(other + sep))
      refuse(
        `worktree "${worktree}" lies inside project "${entry.name}" and cannot run for "${project}"`,
      );
  }

  const codeCommon = await gitLine(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    codeFolder,
    git,
  ).catch(() => refuse(`code folder of project "${project}" is not a git checkout`));
  const top = await gitLine(["rev-parse", "--show-toplevel"], worktree, git).catch(() => "");
  if (top !== real) refuse(`worktree "${worktree}" is not the top of a git checkout`);
  const worktreeCommon = await gitLine(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    worktree,
    git,
  ).catch(() => "");
  if (!worktreeCommon || (await fs.realpath(worktreeCommon)) !== (await fs.realpath(codeCommon)))
    refuse(`worktree "${worktree}" belongs to a different repository than project "${project}"`);

  const listing = await git(["worktree", "list", "--porcelain"], codeFolder).catch(() =>
    refuse(`git worktree list failed for project "${project}" code folder`),
  );
  const listed = listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  if (!listed.includes(real))
    refuse(`worktree "${worktree}" is not listed by git worktree list for project "${project}"`);
  return real;
}

/**
 * The working directory for a worker-started Claude Code run: the supplied worktree when one is given
 * and valid, otherwise the project's code folder. Throws before anything is spawned; never falls back.
 */
export async function resolveDelegationCwd(input: {
  project: string;
  worktree?: string;
  projectsRoot: string;
  git?: GitRunner;
}): Promise<DelegationCwd> {
  const git = input.git ?? runGit;
  const codeFolder = await resolveCodeFolder(input.projectsRoot, input.project);
  if (input.worktree === undefined) return { cwd: codeFolder, source: "code-folder" };
  const cwd = await validateWorktree(
    input.worktree,
    input.project,
    codeFolder,
    input.projectsRoot,
    git,
  );
  return { cwd, source: "worktree" };
}
