import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Explicitly selected local instance: never reset, migrate, start, or stop it here.
const root = resolve(import.meta.dirname, "../..");
const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
if (!status.DB_URL || !status.API_URL || !status.SECRET_KEY)
  throw new Error("Local Supabase credentials missing");
for (const url of [status.DB_URL, status.API_URL]) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Expected a loopback Supabase instance");
}
const result = spawnSync("deno", ["task", "integration"], {
  cwd: resolve(root, "supabase/tests/assignments"),
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_DB_URL: status.DB_URL,
    SUPABASE_URL: status.API_URL,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
