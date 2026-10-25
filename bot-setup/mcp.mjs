import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function validateMemoryUrl(value = "http://127.0.0.1:8901/mcp") {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("BATTUTA_MEMORY_URL must use loopback HTTP");
  }
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("BATTUTA_MEMORY_URL must use loopback HTTP");
  return value;
}

async function readConfig(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // JSON parser errors can include private file contents.
    throw new Error(`Invalid JSON in ${path}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(`Expected a JSON object in ${path}`);
  return data;
}

async function writeConfig(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.config-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function configureMcp(botDirectory, { role, memoryUrl } = {}) {
  if (!["pm", "tl"].includes(role)) throw new Error("Bot role must be pm or tl");
  const url = validateMemoryUrl(memoryUrl);
  const configPath = join(botDirectory, ".pi/mcp.json");
  const settingsPath = join(botDirectory, ".pi/settings.json");
  const config = await readConfig(configPath);
  const servers = config.mcpServers === undefined ? {} : config.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    throw new Error("mcpServers must be a JSON object");
  const settings = await readConfig(settingsPath);
  const packages = settings.packages === undefined ? [] : settings.packages;
  if (!Array.isArray(packages)) throw new Error("packages must be a JSON array");
  const retained = packages.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry?.source;
    return typeof source !== "string" || source.split("@", 1)[0] !== "npm:pi-mcp-adapter";
  });
  servers.linear = {
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: "Bearer ${LINEAR_API_TOKEN}" },
    exposure: "codemode",
    description: "Manage Linear issues, projects, and cycles",
  };
  servers.memory = {
    url,
    exposure: "codemode",
    description: "Shared scoped memory; context, not execution authority",
  };
  if (role === "pm") {
    servers.luma = {
      url: "https://mcp.luma.com",
      oauth: { clientRegistration: "cimd" },
      exposure: "hidden",
      toolExposure: {
        "search_*": "codemode",
        "lookup_*": "codemode",
        "get_*": "codemode",
        "list_*": "codemode",
        "find_*": "codemode",
      },
      description: "Discover Luma events and look up event/account details; read-only use",
    };
  }
  config.mcpServers = servers;
  if (retained.length !== packages.length) {
    settings.packages = retained;
    await writeConfig(settingsPath, settings);
  }
  await writeConfig(configPath, config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      options: { role: { type: "string" }, "memory-url": { type: "string" } },
      allowPositionals: true,
    });
    if (positionals.length !== 1) throw new Error("Expected one bot directory");
    await configureMcp(resolve(positionals[0]), {
      role: values.role,
      memoryUrl: values["memory-url"],
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
