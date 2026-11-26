import { execFile } from "node:child_process";
import { z } from "zod";

/** Project names from `battuta-project list --json`; memory also knows `global`, which is never listed. */
export async function loadProjectCatalog(signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "battuta-project",
      ["list", "--json"],
      { signal, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, output) => {
        if (error) reject(new Error("Project catalog unavailable"));
        else resolve(output);
      },
    );
  });
  const { projects } = z.object({ projects: z.array(z.string()) }).parse(JSON.parse(stdout));
  return [...new Set(projects)].filter((name) => name.toLowerCase() !== "global").sort();
}
