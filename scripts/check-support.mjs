import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function pythonTests(directory, project) {
  const prefix = [
    "run",
    ...(project ? ["--project", resolve(root, project)] : []),
    "--locked",
    "python",
  ];
  const tests = resolve(root, directory);
  run("uv", [...prefix, "-m", "unittest", "discover", "-s", tests, "-v"]);
  // unittest discovery excludes dotted module names; integration files are executable suites.
  for (const file of readdirSync(tests)
    .filter((name) => name.endsWith(".it.py"))
    .sort()) {
    run("uv", [...prefix, resolve(tests, file)]);
  }
}
run("bash", ["-n", "packaging/battuta", "bots/pm-bot/scripts/run-dev.sh"]);
run("bash", ["-n", "scripts/setup-memory.sh", "scripts/setup-artifacts.sh"]);
run("node", ["--check", "packaging/configure.mjs"]);
run("node", ["--test", "bot-setup/tests/mcp.test.mjs"]);
run("node", ["--check", "packaging/shared-resources.mjs"]);
run("node", ["--check", "packaging/install-services.mjs"]);
pythonTests("scripts/tests");
pythonTests("memory-service/tests", "memory-service");

const sharedSkills = resolve(root, "shared-skills");
pythonTests("artifact-service/tests", "artifact-service");
for (const cli of readdirSync(sharedSkills, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith("-cli"))
  .sort((left, right) => left.name.localeCompare(right.name))) {
  pythonTests(resolve(sharedSkills, cli.name, "tests"), resolve(sharedSkills, cli.name));
}
