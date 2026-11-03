import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSkillSelection } from "../bot-setup/skills.mjs";

export async function stageSkills(root) {
  const selections = [];
  for (const bot of ["pm-bot", "tl-bot"]) {
    const directory = join(root, "bots", bot);
    const names = await loadSkillSelection(
      join(directory, "skills.json"),
      join(root, "skills-hub"),
    );
    selections.push({ directory, names });
  }
  for (const { directory, names } of selections) {
    const skills = join(directory, ".pi/skills");
    // Staging is disposable: discard archived development discovery links, not runtime state.
    await rm(skills, { recursive: true, force: true });
    await mkdir(skills, { recursive: true });
    for (const name of names) {
      const source = join(root, "skills-hub", name);
      const destination = join(skills, name);
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        errorOnExist: true,
        force: false,
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: stage-skills.mjs <archive-root>");
    await stageSkills(resolve(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
