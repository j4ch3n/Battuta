import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const nodeFiles = [];
const functions = new Map();
for (const file of process.argv.slice(2)) {
  const path = relative(root, file).split(sep).join("/");
  const match = /^supabase\/functions\/([^/]+)\//.exec(path);
  if (match) {
    const files = functions.get(match[1]) ?? [];
    files.push(file);
    functions.set(match[1], files);
  } else nodeFiles.push(file);
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (nodeFiles.length) run("pnpm", ["exec", "eslint", "--max-warnings=0", ...nodeFiles]);
for (const [name, files] of functions) {
  run("deno", ["lint", ...files], resolve(root, "supabase/functions", name));
}
