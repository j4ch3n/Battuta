import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { configureSharedResources } from "./shared-resources.mjs";
import { configureSubagents } from "./configure-subagents.mjs";
import { configureMcp, validateMemoryUrl } from "../bot-setup/mcp.mjs";
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
    settingsPath: join(piDirectory, "settings.json"),
  };
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env.prod`);
  return value;
}

async function checkMigrationTarget(path, content) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || !(await readFile(path)).equals(content))
      throw new Error(`Refusing to overwrite existing configuration: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const { values } = parseArgs({ options: { "migrate-from": { type: "string" } } });
const oldBotsDirectory = values["migrate-from"];
if (oldBotsDirectory === "") throw new Error("--migrate-from requires a bots directory");
const migrating = oldBotsDirectory !== undefined;
let owner;
if (!migrating) {
  owner = Number(required("TELEGRAM_ALLOWED_USER_ID"));
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("Invalid TELEGRAM_ALLOWED_USER_ID");
}
required("LINEAR_API_TOKEN");
required("SUPABASE_URL");
required("SUPABASE_SECRET_KEY");
const memoryUrl = validateMemoryUrl(process.env.BATTUTA_MEMORY_URL);

// Preflight both roles before changing private state; never log JSON parser errors.
const migration = [];
if (migrating) {
  for (const bot of BOT_CONFIGURATIONS) {
    for (const name of ["telegram.json", "mcp-auth.json"]) {
      const source = join(resolve(oldBotsDirectory), `${bot.name.toLowerCase()}-bot`, ".pi", name);
      let content;
      try {
        content = await readFile(source);
      } catch (error) {
        if (error.code === "ENOENT" && name === "mcp-auth.json") continue;
        throw error;
      }
      let data;
      try {
        data = JSON.parse(content.toString("utf8"));
      } catch {
        throw new Error(`Invalid JSON in ${source}`);
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error(`Expected a JSON object in ${source}`);
      const path = join(bot.piDirectory, name);
      await checkMigrationTarget(path, content);
      migration.push({ path, content });
    }
  }
}
for (const { path, content } of migration) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    await checkMigrationTarget(path, content);
  }
  await chmod(path, 0o600);
}

// Explicit configuration may create a missing store; launch only validates it.
schedulerCatchUpMax();
await initializeSchedulerStore(schedulerStorePath());
for (const bot of BOT_CONFIGURATIONS) {
  await configureSharedResources(PACKAGE_ROOT, bot.directory);

  let telegram;
  if (!migrating) {
    const token = required(`${bot.name}_TELEGRAM_TOKEN`);
    const [id, secret] = token.split(":");
    const botId = Number(id);
    if (!secret || !Number.isSafeInteger(botId) || botId <= 0)
      throw new Error(`Invalid ${bot.name}_TELEGRAM_TOKEN`);
    const username = (process.env[`${bot.name}_TELEGRAM_BOT_USERNAME`] || "").replace(/^@/, "");
    if (username && !/^[a-zA-Z0-9_]+$/.test(username))
      throw new Error(`Invalid ${bot.name}_TELEGRAM_BOT_USERNAME`);

    telegram = { profiles: { default: { botToken: token, allowedUserId: owner, botId } } };
    if (username) telegram.profiles.default.botUsername = username;
  }
  await configureMcp(bot.directory, { role: bot.name.toLowerCase(), memoryUrl });

  // Retained state can omit newly bundled packages or load the old memory adapter.
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
  const retained = packages.filter((entry) => packageName(entry) !== "npm:pi-memory-stone");
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
  if (!migrating)
    await writeFile(bot.telegramConfigPath, JSON.stringify(telegram, null, 2), { mode: 0o600 });
}
console.log("Configured both bots. Run bin/battuta start-prod.");
