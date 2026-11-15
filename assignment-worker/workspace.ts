import { promises as fs } from "node:fs";
import { isAbsolute, join, parse } from "node:path";

export async function ensureAssignmentWorkspace(
  root: string,
  target: { project: string; assignment_id: string },
): Promise<{ directory: string; notePath: string }> {
  const { project, assignment_id } = target;
  if (
    !/\S/u.test(project) ||
    project.startsWith(".") ||
    /[/\\\p{Cc}]/u.test(project) ||
    !/^[0-9a-f]{8}$/.test(assignment_id)
  )
    throw new Error("Invalid assignment workspace target");
  if (
    !isAbsolute(root) ||
    /[\\\p{Cc}]/u.test(root) ||
    root.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Workspace root must be an absolute local path without traversal");
  const directory = join(root, "projects", project, "work", assignment_id);
  // shortcut: trusted single-writer workspace, use directory-relative operations if that changes.
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split("/")) {
    current = join(current, part);
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Workspace contains a symlink or non-directory");
  }
  const notePath = join(directory, "note.md");
  try {
    const handle = await fs.open(notePath, "wx", 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (!(await fs.lstat(notePath)).isFile())
    throw new Error("Assignment note must be a regular local file");
  return { directory, notePath };
}
