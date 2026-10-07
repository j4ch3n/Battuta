import { homedir } from "node:os";
import { join } from "node:path";
import { projectDirectory } from "./discovery.ts";

export interface SpecStorage {
  specs: string;
}

export const defaultProjectsRoot = () => join(homedir(), ".battuta", "projects");

export async function resolveSpecStorage(root: string, name: string): Promise<SpecStorage> {
  const path = await projectDirectory(root, name);
  return { specs: join(path, "specs") };
}
