import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectsRoot } from "./binding.ts";
import { defaultAgentDirectory, defaultDatabasePath, readConfig } from "./config.ts";
import { OwnerProfile } from "./profile/storage.ts";
import { registerProfileTools } from "./profile/tools.ts";
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
  const agentDirectory = options?.agentDirectory ?? defaultAgentDirectory();
  const config = await readConfig(agentDirectory);
  const profile = config.ownerProfile ? new OwnerProfile(agentDirectory) : undefined;
  const store = await MemoryStore.open(path);
  const runtime = new MemoryRuntime(store, options?.projectsRoot ?? projectsRoot());
  registerTools(pi, runtime);
  if (profile) registerProfileTools(pi, profile);
  registerHooks(pi, runtime, config, agentDirectory, profile);
  registerCommands(pi, runtime, path, config);
}
