import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

export interface ProjectBinding {
  name: string;
  checkout: string;
  projectId: string;
}
export const projectsRoot = () => join(homedir(), ".battuta", "projects");
const git = promisify(execFile);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project registration");
  return value as Record<string, unknown>;
}
async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Project directory must be a real directory: ${path}`);
}
async function file(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Project configuration must be a regular file: ${path}`);
  return readFile(path, "utf8");
}

export async function resolveBinding(root = projectsRoot()): Promise<ProjectBinding> {
  try {
    root = resolve(root);
    await directory(dirname(root));
    await directory(root);
    const state = object(JSON.parse(await file(join(root, ".config.json"))));
    const name = state.currentProject;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      [".", "..", ".config.json"].includes(name) ||
      /[/\\\0]/.test(name)
    )
      throw new Error("No valid current project");
    const registration = join(root, name);
    await directory(registration);
    const config = object(parse(await file(join(registration, "project.yaml"))));
    const project = object(config.project);
    const expected = join(registration, "code");
    if (config.version !== 1 || project.name !== name || project.path !== expected)
      throw new Error(`Invalid registration for ${name}`);
    await directory(expected);
    const checkout = await realpath(expected);
    let projectId = checkout;
    try {
      const result = await git("git", ["rev-parse", "--show-toplevel"], { cwd: checkout });
      projectId = await realpath(result.stdout.trim());
    } catch {
      // Stone's documented fallback for a real checkout without Git metadata.
    }
    return { name, checkout, projectId };
  } catch (error) {
    throw new Error(
      `Select a valid project with battuta-project switch before using project memory: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
