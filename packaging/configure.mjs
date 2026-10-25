import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureSharedResources } from "./shared-resources.mjs";
import { configureSubagents } from "./configure-subagents.mjs";
import { schedulerStorePath, schedulerCatchUpMax } from "../memory-client/scheduler-config.ts";
import { initializeSchedulerStore } from "../memory-client/scheduler-store.ts";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// In source this is the repository root; in a release it is the archive root.
const PACKAGE_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const BOTS_DIRECTORY = join(PACKAGE_ROOT, "bots");
const SCHEDULE_PACKAGE = "npm:@jl1990/pi-scheduler@0.5.1";
const BOT_CONFIGURATIONS = [
  {
    name: "PM",
    directory: join(BOTS_DIRECTORY, "pm-bot"),
  },
  {
    name: "TL",
    directory: join(BOTS_DIRECTORY, "tl-bot"),
  },
].map((bot) => {
  const piDirectory = join(bot.directory, ".pi");
  return {
    ...bot,
    piDirectory,
    telegramConfigPath: join(piDirectory, "telegram.json"),
    mcpConfigPath: join(piDirectory, "mcp.json"),
    settingsPath: join(piDirectory, "settings.json"),
  };
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env.prod`);
  return value;
}

const owner = Number(required("TELEGRAM_ALLOWED_USER_ID"));
if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("Invalid TELEGRAM_ALLOWED_USER_ID");
required("LINEAR_API_TOKEN");
required("SUPABASE_URL");
required("SUPABASE_SECRET_KEY");
const memoryUrl = process.env.BATTUTA_MEMORY_URL || "http://127.0.0.1:8901/mcp";
const endpoint = new URL(memoryUrl);
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password
)
  throw new Error("BATTUTA_MEMORY_URL must use loopback HTTP");

// Explicit configuration may create a missing store; launch only validates it.
schedulerCatchUpMax();
await initializeSchedulerStore(schedulerStorePath());
for (const bot of BOT_CONFIGURATIONS) {
  await configureSharedResources(PACKAGE_ROOT, bot.directory);

  const token = required(`${bot.name}_TELEGRAM_TOKEN`);
  const [id, secret] = token.split(":");
  const botId = Number(id);
  if (!secret || !Number.isSafeInteger(botId) || botId <= 0)
    throw new Error(`Invalid ${bot.name}_TELEGRAM_TOKEN`);
  const username = (process.env[`${bot.name}_TELEGRAM_BOT_USERNAME`] || "").replace(/^@/, "");
  if (username && !/^[a-zA-Z0-9_]+$/.test(username))
    throw new Error(`Invalid ${bot.name}_TELEGRAM_BOT_USERNAME`);

  const telegram = { profiles: { default: { botToken: token, allowedUserId: owner, botId } } };
  if (username) telegram.profiles.default.botUsername = username;
  let mcpConfig = {};
  try {
    mcpConfig = JSON.parse(await readFile(bot.mcpConfigPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!mcpConfig || typeof mcpConfig !== "object" || Array.isArray(mcpConfig))
    throw new Error("Invalid MCP config");
  mcpConfig.mcpServers ??= {};
  if (typeof mcpConfig.mcpServers !== "object" || Array.isArray(mcpConfig.mcpServers))
    throw new Error("Invalid MCP servers");
  mcpConfig.mcpServers.linear = {
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: "Bearer ${LINEAR_API_TOKEN}" },
    exposure: "codemode",
    description: "Manage Linear issues, projects, and cycles",
  };
  mcpConfig.mcpServers.memory = {
    url: memoryUrl,
    exposure: "codemode",
    description: "Shared scoped memory; context, not execution authority",
  };
  const mcpConfigJson = JSON.stringify(mcpConfig, null, 2);

  // Retained state can load the old MCP adapter or omit newly bundled PM packages.
  let settings = {};
  try {
    settings = JSON.parse(await readFile(bot.settingsPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error(`Expected a JSON object in ${bot.settingsPath}`);
  const packages = settings.packages ?? [];
  if (!Array.isArray(packages)) throw new Error(`Expected packages array in ${bot.settingsPath}`);
  const packageName = (entry) => {
    const source = typeof entry === "string" ? entry : entry?.source;
    return typeof source === "string" ? source.replace(/@[^@/]+$/, "") : undefined;
  };
  const retained = packages.filter(
    (entry) => !["npm:pi-mcp-adapter", "npm:pi-memory-stone"].includes(packageName(entry)),
  );
  if (bot.name === "PM") {
    for (const source of [SCHEDULE_PACKAGE]) {
      if (!retained.some((entry) => packageName(entry) === packageName(source)))
        retained.push(source);
    }
  }
  const capture = settings.battutaMemoryCapture ?? {};
  if (
    !capture ||
    typeof capture !== "object" ||
    Array.isArray(capture) ||
    Object.keys(capture).some((k) => !["enabled", "batchMessages"].includes(k)) ||
    typeof (capture.enabled ?? true) !== "boolean" ||
    !Number.isInteger(capture.batchMessages ?? 6) ||
    (capture.batchMessages ?? 6) < 1 ||
    (capture.batchMessages ?? 6) > 100
  )
    throw new Error(`Invalid battutaMemoryCapture in ${bot.settingsPath}`);
  const extensions = settings.extensions ?? [];
  if (!Array.isArray(extensions)) throw new Error("Invalid extensions array");
  if (settings.extensions !== undefined)
    settings.extensions = extensions.filter(
      (e) => typeof e !== "string" || !e.replaceAll("\\", "/").endsWith("memory-stone/index.ts"),
    );
  if (settings.packages !== undefined || retained.length > 0) settings.packages = retained;
  delete settings.battutaMemory;
  settings.battutaMemoryCapture = { enabled: true, batchMessages: 6, ...capture };
  if (bot.name === "TL") {
    settings.battutaMemoryCapture.enabled = false;
    configureSubagents(settings, bot.directory);
  }
  await writeFile(bot.settingsPath, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });

  await writeFile(bot.telegramConfigPath, JSON.stringify(telegram, null, 2), { mode: 0o600 });
  await writeFile(bot.mcpConfigPath, mcpConfigJson, { mode: 0o600 });
}
console.log("Configured both bots. Run bin/battuta start-prod.");
