import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function registryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "battuta-memory-"));
  const root = join(directory, "projects");
  await mkdir(root);
  const projects: Record<string, string> = {};
  for (const name of ["atlas", "harbor"]) {
    const checkout = join(root, name, "code");
    await mkdir(checkout, { recursive: true });
    execFileSync("git", ["init", "--quiet", checkout]);
    await writeFile(
      join(root, name, "project.yaml"),
      JSON.stringify({
        version: 1,
        project: { name, path: checkout },
        github: { repository: `team/${name}` },
        linear: { project_id: null, team_id: null },
      }),
    );
    projects[name] = checkout;
  }
  const select = async (name: string | null) => {
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: name }));
  };
  await select("atlas");
  return {
    directory,
    root,
    projects,
    select,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
