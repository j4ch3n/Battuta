import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";
import { directory, readOptional } from "./files.ts";

export interface Project {
  name: string;
  root: string;
  code: string;
  specs: string;
  configuration: unknown;
}
export const defaultProjectsRoot = () => join(homedir(), ".battuta", "projects");

export async function registryRoot(root: string) {
  await directory(dirname(root), true);
  return directory(root, true);
}

export async function loadProject(root: string, name: string): Promise<Project> {
  if (!name.trim() || [".", ".."].includes(name) || /[/\\\0]/.test(name))
    throw new Error("Project must be an exact registered folder name");
  await registryRoot(root);
  const path = join(root, name);
  await directory(path);
  const bytes = await readOptional(join(path, "project.yaml"));
  if (!bytes) throw new Error(`Project registration not found: ${name}`);
  let configuration: unknown;
  try {
    configuration = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`Invalid project configuration: ${name}`);
  }
  const config = configuration as {
    version?: unknown;
    project?: { name?: unknown; path?: unknown };
  } | null;
  const code = join(path, "code");
  if (
    !config ||
    config.version !== 1 ||
    config.project?.name !== name ||
    typeof config.project.path !== "string" ||
    !isAbsolute(config.project.path) ||
    resolve(config.project.path) !== code
  ) {
    throw new Error(`Invalid project configuration or checkout path: ${name}`);
  }
  await directory(code);
  return { name, root: path, code, specs: join(path, "specs"), configuration };
}

export async function listProjects(root: string): Promise<Project[]> {
  if (!(await registryRoot(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  return Promise.all(names.map((name) => loadProject(root, name)));
}
