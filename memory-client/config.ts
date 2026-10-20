import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const settingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    batchMessages: z.number().int().min(1).max(100).default(6),
  })
  .strict();
export async function captureSettings(directory: string, role: "pm" | "tl" = "pm") {
  const schema = settingsSchema.extend({ enabled: z.boolean().default(role === "pm") });
  try {
    const settings: unknown = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
    return schema.parse(
      (settings as { battutaMemoryCapture?: unknown })?.battutaMemoryCapture ?? {},
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return schema.parse({});
    throw error;
  }
}

export function clientConfig() {
  const role = process.env.AGENT_ROLE;
  if (role !== "pm" && role !== "tl") throw new Error("AGENT_ROLE must be pm or tl");
  const dataDirectory = process.env.BATTUTA_MEMORY_DATA_DIR ?? join(homedir(), ".battuta/memory");
  return {
    role,
    dataDirectory,
    directory: process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), ".pi"),
    registry: process.env.BATTUTA_PROJECTS_ROOT ?? join(homedir(), ".battuta/projects"),
    queue: join(dataDirectory, "capture-queue", role),
    url: process.env.BATTUTA_MEMORY_URL ?? "http://127.0.0.1:8901/mcp",
  } as const;
}
