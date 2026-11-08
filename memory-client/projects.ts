import { execFile } from "node:child_process";
import { z } from "zod";
import { memoryProjectsSchema } from "./records.ts";

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
  signal.throwIfAborted();
  try {
    const { projects } = z
      .object({ projects: z.array(z.string()) })
      .strict()
      .parse(JSON.parse(stdout));
    if (
      new Set(projects).size !== projects.length ||
      projects.some((p) => p.toLowerCase() === "global")
    )
      throw new Error("Reserved or duplicate project");
    return [...projects, "global"].sort();
  } catch {
    throw new Error("Project catalog invalid or reserved name collision");
  }
}

export function validateMemoryProjects(projects: unknown, catalog: readonly string[]): string[] {
  const result = memoryProjectsSchema.safeParse(projects);
  if (!result.success || result.data.some((p) => !catalog.includes(p)))
    throw new Error("Memory project membership invalid");
  return result.data;
}

export { normalizedProjects } from "./canonical.ts";
