import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("uv", ["run", "--locked", "python", "-m", "unittest", "discover", "-s", "tests", "-v"]);
run("bash", ["-n", "packaging/battuta", "bots/pm-bot/scripts/run-dev.sh"]);
run("node", ["--check", "packaging/configure.mjs"]);
run("node", ["--check", "packaging/install-services.mjs"]);
