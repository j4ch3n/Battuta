import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { directory, readOptional } from "./files.ts";

function discoveryError(message: string): Error {
  return new Error(
    `${message} Use battuta-project list to discover registered projects, or battuta-project init <project-name> to initialize a project before using spec tools.`,
  );
}

export async function projectDirectory(root: string, name: string): Promise<string> {
  if (!name.trim() || name.startsWith(".") || /[/\\\0]/.test(name))
    throw new Error("Project must be an exact registered folder name");
  if (!(await directory(dirname(root), true)) || !(await directory(root, true)))
    throw discoveryError("No Battuta project store has been initialized.");
  const path = join(root, name);
  const exists = await directory(path, true);
  const entries = await readdir(root, { withFileTypes: true });
  if (
    exists &&
    entries.some((entry) => entry.name === name) &&
    (await readOptional(join(path, "project.yaml")))
  )
    return path;
  let hasProjects = false;
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      (await readOptional(join(root, entry.name, "project.yaml")))
    ) {
      hasProjects = true;
      break;
    }
  }
  throw discoveryError(
    hasProjects ? `Project '${name}' is not registered.` : "No registered projects.",
  );
}
