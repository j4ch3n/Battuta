import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const workdir = mkdtempSync(resolve(tmpdir(), "battuta-check-"));
const reports = resolve(root, ".reports");
mkdirSync(resolve(workdir, "supabase"));
mkdirSync(reports, { recursive: true });
// Separate project, ports and copied sources: never reset or stop the developer's stack.
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8")
  .replace(/^project_id = .*$/m, 'project_id = "battuta-check"')
  .replace(/543(\d{2})/g, "553$1")
  .replace("inspector_port = 8083", "inspector_port = 8183")
  .replace('sql_paths = ["./seed.sql"]', "sql_paths = []");
writeFileSync(resolve(workdir, "supabase/config.toml"), config);
for (const directory of ["functions", "migrations", "tests"]) {
  cpSync(resolve(root, "supabase", directory), resolve(workdir, "supabase", directory), {
    recursive: true,
    filter: (path) => !["node_modules", ".env"].includes(path.split(/[\\/]/).at(-1)),
  });
}
if (existsSync(resolve(root, "supabase/seed.sql"))) {
  cpSync(resolve(root, "supabase/seed.sql"), resolve(workdir, "supabase/seed.sql"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} exited ${result.status}`);
  return result.stdout;
}
const cli = (...args) => run("supabase", ["--workdir", workdir, ...args]);
const logPath = resolve(reports, "edge-functions.log");
const log = openSync(logPath, "w");
let server;
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  server?.kill("SIGTERM");
  spawnSync("supabase", ["--workdir", workdir, "stop", "--no-backup"], { stdio: "inherit" });
  rmSync(workdir, { recursive: true, force: true });
  closeSync(log);
  if (signal) process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
try {
  cli("start", "--exclude", "studio,imgproxy,logflare,vector,supavisor");
  cli("db", "reset", "--local", "--no-seed", "--yes");
  cli("db", "lint", "--local", "--schema", "public", "--fail-on", "warning");
  cli("test", "db");
  const status = JSON.parse(
    run("supabase", ["--workdir", workdir, "status", "-o", "json"], {
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
    }),
  );
  if (!status.API_URL || !status.SECRET_KEY || !status.PUBLISHABLE_KEY)
    throw new Error("Local Supabase credentials missing");
  server = spawn("supabase", ["--workdir", workdir, "functions", "serve"], {
    cwd: root,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      LINEAR_WEBHOOK_SECRET: "ci-test-secret",
      LINEAR_API_TOKEN: "ci-test-token",
    },
  });
  let spawnError;
  server.on("error", (error) => {
    spawnError = error;
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Edge server stopped; see ${logPath}`);
    try {
      const response = await fetch(`${status.API_URL}/functions/v1/agent-mail`, {
        headers: { apikey: status.SECRET_KEY },
        signal: AbortSignal.timeout(2000),
      });
      await response.arrayBuffer();
      if (response.status === 405) {
        ready = true;
        break;
      }
    } catch {
      /* Server may still be starting. */
    }
    await setTimeout(1000);
  }
  if (!ready) throw new Error(`Edge Functions did not become ready; see ${logPath}`);
  run(
    "pnpm",
    [
      "--dir",
      "agent-mail",
      "test:integration",
      "--reporter=default",
      "--reporter=junit",
      `--outputFile=${resolve(reports, "integration.xml")}`,
    ],
    {
      env: { ...process.env, SUPABASE_URL: status.API_URL, SUPABASE_SECRET_KEY: status.SECRET_KEY },
    },
  );
  run(
    "pnpm",
    [
      "--dir",
      "task-delegation",
      "test:integration",
      "--reporter=default",
      "--reporter=junit",
      `--outputFile=${resolve(reports, "task-integration.xml")}`,
    ],
    {
      env: {
        ...process.env,
        SUPABASE_URL: status.API_URL,
        SUPABASE_SECRET_KEY: status.SECRET_KEY,
        SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
        SUPABASE_TEST_DB_CONTAINER: "supabase_db_battuta-check",
      },
    },
  );
} finally {
  shutdown();
}
