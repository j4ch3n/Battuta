import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Setup only: execution, authentication and lifecycle belong to pi-subagents.
export function configureSubagents(settings, botDirectory) {
  const packages = settings.packages ?? [];
  const extensions = settings.extensions ?? [];
  const subagents = settings.subagents ?? {};
  if (!Array.isArray(packages) || !Array.isArray(extensions) || !object(subagents))
    throw new Error("Invalid Pi packages, extensions or subagents settings");
  const overrides = subagents.agentOverrides ?? {};
  if (!object(overrides)) throw new Error("Invalid subagents.agentOverrides");

  const source = "npm:pi-subagents@0.82.1";
  const installed = packages.findIndex((entry) =>
    /^npm:pi-subagents(?:@|$)/.test(typeof entry === "string" ? entry : (entry?.source ?? "")),
  );
  if (installed < 0) packages.push(source);
  else
    packages[installed] =
      typeof packages[installed] === "string" ? source : { ...packages[installed], source };
  settings.packages = packages;
  if (settings.extensions !== undefined)
    settings.extensions = extensions.filter(
      (entry) =>
        typeof entry !== "string" ||
        !entry.replaceAll("\\", "/").endsWith("/bounded-subagents/index.ts"),
    );

  // pi-web-access@0.43.0 declares ./dist as its extension entrypoint.
  subagents.defaultExtensions ??= [
    join(resolve(botDirectory), ".pi/npm/node_modules/pi-web-access/dist"),
  ];
  subagents.agentOverrides = overrides;
  for (const name of [
    "scout",
    "worker",
    "reviewer",
    "researcher",
    "evidence-auditor",
    "oracle",
    "delegate",
  ]) {
    if (overrides[name] !== undefined && !object(overrides[name]))
      throw new Error(`Invalid subagents.agentOverrides.${name}`);
    overrides[name] = {
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      skills: [],
      defaultContext: "fresh",
      tools: [
        "read",
        "grep",
        "find",
        "ls",
        ...(["worker", "delegate"].includes(name) ? ["bash", "edit", "write"] : []),
        "web_search",
        "fetch_content",
        "get_search_content",
        "source_check",
      ],
      ...overrides[name],
    };
  }
  settings.subagents = subagents;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const botDirectory = resolve(process.argv[2]);
  const path = join(botDirectory, ".pi/settings.json");
  let settings = {};
  try {
    settings = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!object(settings)) throw new Error(`Expected a JSON object in ${path}`);
  configureSubagents(settings, botDirectory);
  await mkdir(join(botDirectory, ".pi"), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
}
