import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("bash", ["-n", "packaging/battuta", "bots/pm-bot/scripts/run-dev.sh"]);
run("node", ["--check", "packaging/configure.mjs"]);
run("node", ["--check", "packaging/shared-resources.mjs"]);
run("node", ["--check", "packaging/install-services.mjs"]);
run("uv", ["run", "--locked", "python", "-m", "unittest", "discover", "-s", "scripts/tests", "-v"]);

const sharedSkills = resolve(root, "shared-skills");
for (const cli of readdirSync(sharedSkills, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith("-cli"))
  .sort((left, right) => left.name.localeCompare(right.name))) {
  run("uv", [
    "run",
    "--project",
    resolve(sharedSkills, cli.name),
    "--locked",
    "python",
    "-m",
    "unittest",
    "discover",
    "-s",
    resolve(sharedSkills, cli.name, "tests"),
    "-v",
  ]);
}
