import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryRuntime } from "./lifecycle.ts";
import type { MemoryConfig } from "./config.ts";
import { registerStatus } from "./commands/status.ts";
import { registerRecall } from "./commands/recall.ts";
import { registerForgetCommand } from "./commands/forget.ts";

export function registerCommands(
  pi: ExtensionAPI,
  runtime: MemoryRuntime,
  path: string,
  config: MemoryConfig,
) {
  registerStatus(pi, runtime, path, config);
  registerRecall(pi, runtime);
  registerForgetCommand(pi, runtime);
}
