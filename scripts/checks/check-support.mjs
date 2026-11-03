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
    project.startsWith("scripts/")
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
run("bash", ["-n", "scripts/packaging/battuta", "bots/pm-bot/scripts/run-dev.sh"]);
run("bash", ["-n", "scripts/setup-memory.sh", "scripts/setup-artifacts.sh"]);
pythonTests("scripts/bot_setup/tests", "scripts/bot_setup");
pythonTests("scripts/packaging/tests", "scripts/packaging");
pythonTests("memory-service/tests", "memory-service");

pythonTests("artifact-service/tests", "artifact-service");
pythonTests("project-context-cli/tests", "project-context-cli");
