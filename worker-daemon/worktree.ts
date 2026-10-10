import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { initialPromptId, validateTaskRow } from "../supabase/functions/_shared/task-contracts.ts";
import type { TaskRow } from "../supabase/functions/_shared/task-contracts.ts";
import { runGit, safeIdentifier, verifyCheckout } from "./config.ts";
import type { Git, WorkerConfig } from "./config.ts";

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function taskBranch(task: TaskRow): string {
  initialPromptId(task.id);
  if (!safeIdentifier(task.project) || (task.ticket_id !== null && !safeIdentifier(task.ticket_id)))
    throw new Error("Unsafe task identifier");
  const ticket = slug(task.ticket_id ?? `task-${task.id.replaceAll("-", "")}`) || "task";
  const summary =
    slug(task.instruction.summary).split("-").filter(Boolean).slice(0, 2).join("-") || "work";
  return `agent/${ticket}-${summary}-${task.id.toLowerCase().replaceAll("-", "")}`;
}
export function worktreePath(task: TaskRow, config: WorkerConfig): string {
  taskBranch(task);
  if (!isAbsolute(config.worktreeRoot)) throw new Error("Worktree root must be absolute");
  return join(config.worktreeRoot, `${slug(task.project) || "project"}-${task.id.toLowerCase()}`);
}
export async function assertNoSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Unsafe symlink ancestor");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export async function validateWorktreeLocation(
  task: TaskRow,
  config: WorkerConfig,
  directory: string,
): Promise<void> {
  const expected = worktreePath(task, config);
  if (directory !== expected) throw new Error("Worktree location mismatch");
  await assertNoSymlinks(expected);
  const root = await realpath(config.worktreeRoot);
  const target = await realpath(directory);
  const child = relative(root, target);
  if (!child || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child))
    throw new Error("Worktree containment mismatch");
  const project = config.projects[task.project];
  if (!project) throw new Error("Unconfigured project");
  try {
    const [top, branch, common, sourceCommon] = await Promise.all([
      runGit(directory, ["rev-parse", "--show-toplevel"]),
      runGit(directory, ["branch", "--show-current"]),
      runGit(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      runGit(project.checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ]);
    if (
      (await realpath(top)) !== target ||
      branch !== taskBranch(task) ||
      (await realpath(common)) !== (await realpath(sourceCommon))
    )
      throw new Error();
  } catch {
    throw new Error("Git worktree identity mismatch; preserve files and inspect checkout/branch");
  }
}
export async function prepareWorktree(
  task: TaskRow,
  config: WorkerConfig,
  git: Git = runGit,
): Promise<string> {
  validateTaskRow(task);
  if (
    task.claimed_by !== config.workerId ||
    task.opencode_session_id !== null ||
    task.terminal_report !== null
  )
    throw new Error("Fresh owned task required");
  const project = Object.hasOwn(config.projects, task.project)
    ? config.projects[task.project]
    : undefined;
  if (!project) throw new Error("Unconfigured project");
  const target = worktreePath(task, config);
  await assertNoSymlinks(target);
  try {
    await lstat(target);
    throw new Error("Worktree path already exists; operator inspection required");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await verifyCheckout(project.checkout, project.baseRef, git);
  const branch = taskBranch(task);
  // Refuse stale Git registrations too: a missing directory is not a fresh worktree.
  const registrations = await git(project.checkout, [
    "-c",
    "core.quotePath=false",
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  if (registrations.split("\0").includes(`worktree ${target}`))
    throw new Error("Stale worktree registration exists; operator inspection required");
  if (await git(project.checkout, ["branch", "--list", branch]))
    throw new Error("Task branch collision; operator inspection required");
  await mkdir(config.worktreeRoot, { recursive: true });
  await assertNoSymlinks(target);
  try {
    await git(project.checkout, ["worktree", "add", "-b", branch, "--", target, project.baseRef]);
  } catch {
    throw new Error("Worktree creation uncertain; preserve files and inspect Git before retrying");
  }
  await validateWorktreeLocation(task, config, target);
  return target;
}
