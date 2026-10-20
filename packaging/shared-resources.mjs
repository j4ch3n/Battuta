import { lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

async function linkSkill(root, botDirectory, name, sourceName = name) {
  const skills = join(botDirectory, ".pi", "skills");
  const source = join(root, "shared-skills", sourceName);
  if (!(await lstat(source)).isDirectory()) throw new Error(`Missing shared skill: ${source}`);
  await mkdir(skills, { recursive: true });
  const link = join(skills, name);
  const target = relative(skills, source);
  try {
    const stat = await lstat(link);
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace existing skill: ${link}`);
    const existing = await readlink(link);
    if (existing === target) return;
    const ownedProject =
      name === "project-context" && existing === "../../../shared-skills/project-context";
    const ownedTlMemory =
      name === "memory" &&
      sourceName === "memory-tl" &&
      existing === "../../../../shared-skills/memory";
    if (!ownedProject && !ownedTlMemory)
      throw new Error(`Refusing to replace existing skill: ${link}`);
    await unlink(link);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await symlink(target, link, "dir");
}

export async function configureSharedResources(
  root,
  botDirectory,
  role = basename(botDirectory).replace(/-bot$/, ""),
) {
  if (!["pm", "tl"].includes(role)) throw new Error(`Unknown bot role: ${role}`);
  await linkSkill(root, botDirectory, "project-context");
  await linkSkill(root, botDirectory, "memory", role === "tl" ? "memory-tl" : "memory");
  const shared = await readFile(join(root, "bots", "AGENTS_shared.md"), "utf8");
  const dedicated = await readFile(join(botDirectory, "AGENTS_dedicated.md"), "utf8");
  const sections = [shared, dedicated];
  await writeFile(join(botDirectory, "AGENTS.md"), sections.join("\n"));
}
