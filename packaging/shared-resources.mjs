import { lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadSkillSelection } from "../bot-setup/skills.mjs";

export const sharedSkillNames = ["project-context", "todo", "note-taking"];

export async function configureSharedResources(root, botDirectory) {
  const names = await loadSkillSelection(
    join(botDirectory, "skills.json"),
    join(root, "skills-hub"),
  );
  const skills = join(botDirectory, ".pi", "skills");
  const links = [];
  for (const name of names.filter((name) => sharedSkillNames.includes(name))) {
    const link = join(skills, name);
    const target = relative(skills, join(root, "skills-hub", name));
    try {
      const stat = await lstat(link);
      if (stat.isDirectory()) continue;
      if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace existing skill: ${link}`);
      const existing = await readlink(link);
      if (existing === target) continue;
      const owned = [relative(skills, join(root, "shared-skills", name))];
      if (name === "project-context") owned.push("../../../shared-skills/project-context");
      if (!owned.includes(existing)) throw new Error(`Refusing to replace existing skill: ${link}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    links.push({ link, target });
  }
  await mkdir(skills, { recursive: true });
  for (const { link, target } of links) {
    await unlink(link).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await symlink(target, link, "dir");
  }
  const draft = join(skills, "draft-writing");
  try {
    if (
      (await lstat(draft)).isSymbolicLink() &&
      (await readlink(draft)) === relative(skills, join(root, "shared-skills/draft-writing"))
    )
      await unlink(draft);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const shared = await readFile(join(root, "bots", "AGENTS_shared.md"), "utf8");
  const dedicated = await readFile(join(botDirectory, "AGENTS_dedicated.md"), "utf8");
  await writeFile(join(botDirectory, "AGENTS.md"), [shared, dedicated].join("\n"));
}
