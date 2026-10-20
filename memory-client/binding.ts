import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

async function real(path: string, directory = false) {
  const s = await lstat(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()))
    throw new Error("Invalid project registration");
}
export async function resolveBinding(root: string): Promise<string | null> {
  const state = join(root, ".config.json");
  try {
    await real(state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  await real(root, true);
  const data: unknown = JSON.parse(await readFile(state, "utf8"));
  const name = (data as { currentProject?: unknown })?.currentProject;
  if (name === null || name === undefined) return null;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
    throw new Error("Invalid selected project");
  const folder = join(root, name);
  const config = join(folder, "project.yaml");
  await real(folder, true);
  await real(config);
  await real(join(folder, "code"), true);
  const p = parse(await readFile(config, "utf8")) as {
    version?: unknown;
    project?: { name?: unknown; path?: unknown };
  };
  if (p.version !== 1 || p.project?.name !== name || p.project.path !== join(folder, "code"))
    throw new Error("Invalid project registration");
  return name;
}
