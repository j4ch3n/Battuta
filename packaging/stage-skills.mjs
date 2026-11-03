import { cp, lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSkillSelection } from "../bot-setup/skills.mjs";
import { sharedSkillNames } from "./shared-resources.mjs";

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
    await mkdir(skills, { recursive: true });
    for (const name of names) {
      const source = join(root, "skills-hub", name);
      const destination = join(skills, name);
      try {
        if ((await lstat(destination)).isSymbolicLink()) {
          if ((await readlink(destination)) !== relative(skills, source))
            throw new Error(`Unexpected staged skill link: ${destination}`);
          await unlink(destination);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (sharedSkillNames.includes(name)) {
        await symlink(relative(skills, source), destination, "dir");
      } else {
        await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
      }
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
