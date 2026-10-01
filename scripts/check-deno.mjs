import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const task = process.argv[2];
if (!["lint", "check", "test"].includes(task)) throw new Error("Expected lint, check, or test");
const functions = readdirSync(resolve(root, "supabase/functions"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name);
if (!functions.length) throw new Error("No Edge Functions found");
for (const name of functions) {
  const result = spawnSync("deno", ["task", task], {
    cwd: resolve(root, "supabase/functions", name),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
