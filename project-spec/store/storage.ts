import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { directory } from "./files.ts";

export interface SpecStorage {
  specs: string;
}

export const defaultProjectsRoot = () => join(homedir(), ".battuta", "projects");

export async function resolveSpecStorage(root: string, name: string): Promise<SpecStorage> {
  if (!name.trim() || [".", ".."].includes(name) || /[/\\\0]/.test(name))
    throw new Error("Project must be an exact registered folder name");
  await directory(dirname(root));
  await directory(root);
  const path = join(root, name);
  await directory(path);
  return { specs: join(path, "specs") };
}
