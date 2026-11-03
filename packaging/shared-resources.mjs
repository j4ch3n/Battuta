import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillSelection } from "../bot-setup/skills.mjs";

export async function validateBundledSkills(botDirectory) {
  const skills = join(botDirectory, ".pi", "skills");
  if (!(await lstat(skills)).isDirectory())
    throw new Error(`Expected a local bundled skills directory: ${skills}`);
  const names = await loadSkillSelection(join(botDirectory, "skills.json"), skills);
  const entries = await readdir(skills, { withFileTypes: true });
  if (
    entries.length !== names.length ||
    entries.some((entry) => !entry.isDirectory() || !names.includes(entry.name))
  )
    throw new Error(`Bundled skills do not match manifest: ${botDirectory}`);
  for (const entry of await readdir(skills, { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error(`Unexpected bundled skill link: ${join(entry.parentPath, entry.name)}`);
  }
  return names;
}

export async function configureSharedResources(root, botDirectory) {
  await validateBundledSkills(botDirectory);
  const shared = await readFile(join(root, "bots", "AGENTS_shared.md"), "utf8");
  const dedicated = await readFile(join(botDirectory, "AGENTS_dedicated.md"), "utf8");
  await writeFile(join(botDirectory, "AGENTS.md"), [shared, dedicated].join("\n"));
}
