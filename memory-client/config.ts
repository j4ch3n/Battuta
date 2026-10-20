import { homedir } from "node:os";
import { join } from "node:path";

export function clientConfig() {
  const role = process.env.AGENT_ROLE;
  if (role !== "pm" && role !== "tl") throw new Error("AGENT_ROLE must be pm or tl");
  return {
    role,
    directory: process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), ".pi"),
    registry: process.env.BATTUTA_PROJECTS_ROOT ?? join(homedir(), ".battuta/projects"),
    queue: join(
      process.env.BATTUTA_MEMORY_DATA_DIR ?? join(homedir(), ".battuta/memory-service"),
      "capture-queue",
      role,
    ),
    url: process.env.BATTUTA_MEMORY_URL ?? "http://127.0.0.1:8901/mcp",
  } as const;
}
