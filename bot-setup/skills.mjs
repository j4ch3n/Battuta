import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

async function validateSelection(text, manifest, checkEntry) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid skill manifest JSON: ${manifest}`);
  }
  if (
    !data ||
    typeof data !== "object" ||
    Object.keys(data).length !== 1 ||
    !Array.isArray(data.skills)
  )
    throw new Error(`Invalid skill manifest: ${manifest}; expected {"skills": [...]}`);
  const seen = new Set();
  for (const name of data.skills) {
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      throw new Error(`Invalid skill name in ${manifest}`);
    if (seen.has(name)) throw new Error(`Invalid skill manifest: duplicate ${name} in ${manifest}`);
    seen.add(name);
    await checkEntry(name);
  }
  return data.skills;
}

export async function loadSkillSelection(manifestPath, hubDirectory) {
  const hub = await realpath(hubDirectory);
  return validateSelection(await readFile(manifestPath, "utf8"), manifestPath, async (name) => {
    const entry = join(hub, name, "SKILL.md");
    try {
      const resolved = await realpath(entry);
      const path = relative(hub, resolved);
      if (path.startsWith("..") || isAbsolute(path) || !(await lstat(entry)).isFile())
        throw new Error("Invalid entry point");
    } catch {
      throw new Error(`Missing skill or invalid entry point: ${entry}`);
    }
  });
}

async function checkStaged(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const entries = new Map();
  for (const row of git("ls-files", "--stage", "-z").split("\0").filter(Boolean)) {
    const [header, path] = row.split("\t");
    const [mode, oid, stage] = header.split(" ");
    if (stage !== "0") throw new Error(`Invalid skill index: unresolved conflict at ${path}`);
    entries.set(path, { mode, oid });
  }
  const manifests = [...entries.keys()].filter((path) => /^bots\/[^/]+\/skills\.json$/.test(path));
  if (!manifests.length) throw new Error("Missing skill manifests in Git index");
  for (const manifest of manifests) {
    const item = entries.get(manifest);
    if (!/^100(644|755)$/.test(item.mode))
      throw new Error(`Invalid skill manifest file: ${manifest}`);
    await validateSelection(git("cat-file", "blob", item.oid), manifest, (name) => {
      const entry = entries.get(`skills-hub/${name}/SKILL.md`);
      if (!entry || !/^100(644|755)$/.test(entry.mode))
        throw new Error(`Missing skill entry point in Git index: ${name}`);
    });
  }
}

export async function checkSkillManifests(root, { staged = false } = {}) {
  if (staged) return checkStaged(root);
  let count = 0;
  for (const bot of await readdir(join(root, "bots"), { withFileTypes: true })) {
    if (!bot.isDirectory()) continue;
    const directory = join(root, "bots", bot.name);
    if (!(await readdir(directory)).includes("skills.json")) continue;
    await loadSkillSelection(join(directory, "skills.json"), join(root, "skills-hub"));
    count++;
  }
  if (!count) throw new Error("Missing skill manifests");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({
      options: { check: { type: "boolean" }, staged: { type: "boolean" } },
      allowPositionals: true,
    });
    if (values.check && positionals.length === 0) {
      await checkSkillManifests(process.cwd(), { staged: values.staged });
    } else if (!values.check && !values.staged && positionals.length === 2) {
      console.log(JSON.stringify(await loadSkillSelection(...positionals)));
    } else {
      throw new Error("Usage: skills.mjs <skills.json> <skills-hub> | --check [--staged]");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
