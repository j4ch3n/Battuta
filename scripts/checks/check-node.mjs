import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const component = process.argv[2];
const worker = "assignment-worker";
if (!["agent-mail", "project-spec", "memory-client", worker].includes(component))
  throw new Error("Expected a Node component directory");
function run(args) {
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["install", "--frozen-lockfile"]);
run(["exec", "eslint", component, "--max-warnings=0"]);
run(["--dir", component, "check"]);
if (component === worker) run(["--dir", component, "test"]);
run(["--dir", component, "test:coverage"]);
