import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, TMPDIR: realpathSync("/tmp"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function pythonTests(directory, project) {
  const prefix = ["run", "--project", resolve(root, project), "--locked", "python"];
  const tests = resolve(root, directory);
  run(
    "uv",
    project.startsWith("scripts/") || project === "speech-service"
      ? [...prefix, "-m", "pytest", tests, "-q"]
      : [...prefix, "-m", "unittest", "discover", "-s", tests, "-v"],
  );
  // unittest discovery excludes dotted module names; integration files are executable suites.
  for (const file of readdirSync(tests)
    .filter((name) => name.endsWith(".it.py"))
    .sort()) {
    run("uv", [...prefix, resolve(tests, file)]);
  }
}
const groups = {
  scripts: ["scripts/bot_setup", "scripts/packaging"],
  "memory-service": ["memory-service"],
  "speech-service": ["speech-service"],
  "artifact-service": ["artifact-service"],
  "project-context-cli": ["project-context-cli"],
};
const selected = process.argv.slice(2);
if (selected.some((name) => !Object.hasOwn(groups, name)))
  throw new Error("Unknown support check group");
const names = selected.length ? selected : Object.keys(groups);
if (names.includes("scripts")) {
  run("bash", ["-n", "scripts/packaging/release-build.sh", "scripts/bot_setup/run-dev.sh"]);
  run("bash", ["-n", "scripts/setup-memory.sh", "scripts/setup-artifacts.sh"]);
  run("bash", ["-n", "scripts/bot_setup/run-worker.sh"]);
}
for (const name of names)
  for (const project of groups[name]) pythonTests(`${project}/tests`, project);
