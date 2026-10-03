import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSpecStore } from "../store/index.ts";

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "battuta-spec-"));
  const projects = join(root, "projects");
  for (const name of ["atlas", "harbor"]) {
    const directory = join(projects, name);
    await mkdir(join(directory, "code"), { recursive: true });
    await writeFile(
      join(directory, "project.yaml"),
      JSON.stringify({
        version: 1,
        project: { name, path: join(directory, "code") },
        github: { repository: "team/" + name },
        linear: { project_id: null, team_id: null },
      }),
    );
  }
  const pm = new ProjectSpecStore("pm", projects);
  const tl = new ProjectSpecStore("tl", projects);
  return { root, projects, pm, tl, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export const input = {
  project: "atlas",
  name: "API Design",
  summary: "Initial contract",
  content: "# API\r\n\r\nImport one project.\r\n",
};
