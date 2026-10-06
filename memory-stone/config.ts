import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MemoryConfig {
  ownerProfile: boolean;
  enabled: boolean;
  maxRecords: number;
  maxTokens: number;
  threshold: number;
  includeGlobal: boolean;
}
export const defaultConfig: MemoryConfig = {
  ownerProfile: false,
  enabled: true,
  maxRecords: 5,
  maxTokens: 1000,
  threshold: 0.3,
  includeGlobal: true,
};
export const defaultDatabasePath = () => join(homedir(), ".battuta", "memory", "memory.db");
export const defaultAgentDirectory = () =>
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

export async function readConfig(agentDirectory = defaultAgentDirectory()): Promise<MemoryConfig> {
  let settings: unknown;
  try {
    settings = JSON.parse(await readFile(join(agentDirectory, "settings.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultConfig };
    throw error;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Expected bot settings to be an object");
  const value = (settings as { battutaMemory?: unknown }).battutaMemory;
  if (value === undefined) return { ...defaultConfig };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected battutaMemory configuration to be an object");
  const config = { ...defaultConfig, ...value };
  if (
    typeof config.enabled !== "boolean" ||
    typeof config.ownerProfile !== "boolean" ||
    typeof config.includeGlobal !== "boolean" ||
    !Number.isInteger(config.maxRecords) ||
    config.maxRecords < 1 ||
    config.maxRecords > 20 ||
    !Number.isInteger(config.maxTokens) ||
    config.maxTokens < 50 ||
    config.maxTokens > 4000 ||
    !Number.isFinite(config.threshold) ||
    config.threshold < 0
  )
    throw new Error("Invalid battutaMemory configuration");
  return config;
}
