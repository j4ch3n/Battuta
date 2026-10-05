import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectsRoot } from "./binding.ts";
import { defaultDatabasePath, readConfig } from "./config.ts";
import { MemoryStore } from "./store.ts";
import { MemoryRuntime } from "./lifecycle.ts";
import { registerTools } from "./tools.ts";
import { registerHooks } from "./hooks.ts";
import { registerCommands } from "./commands.ts";

export default async function memoryBridge(
  pi: ExtensionAPI,
  options?: { databasePath?: string; projectsRoot?: string; agentDirectory?: string },
) {
  const path =
    options?.databasePath ?? process.env.PI_MEMORY_STONE_DB_PATH ?? defaultDatabasePath();
  const config = await readConfig(options?.agentDirectory);
  const store = await MemoryStore.open(path);
  const runtime = new MemoryRuntime(store, options?.projectsRoot ?? projectsRoot());
  registerTools(pi, runtime);
  registerHooks(pi, runtime, config, options?.agentDirectory);
  registerCommands(pi, runtime, path, config);
}
