import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const full = args[0] === "--full";
if (full) args.shift();
if (args.length !== 0 && args.length !== 2) throw new Error("Expected [--full] [BASE HEAD]");
const git = (args, options = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", ...options });
const [base, head] = args;
const before =
  base && /^0+$/.test(base)
    ? git(["hash-object", "-t", "tree", "--stdin"], { input: "" }).trim()
    : base;
const files = args.length
  ? git(["diff", "--no-renames", "--name-only", "-z", before, head, "--"])
      .split("\0")
      .filter(Boolean)
  : [];
const changed = (prefix) => files.some((file) => file.startsWith(prefix));
const all =
  full ||
  !args.length ||
  files.some(
    (file) =>
      /^(?:\.github\/|scripts\/checks\/)/.test(file) ||
      [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "eslint.config.mjs",
        ".node-version",
        ".deno-version",
      ].includes(file),
  );
const worker = "assignment-worker";
const node = ["agent-mail", "project-spec", "memory-client", worker];
const python = ["memory-service", "artifact-service", "project-context-cli"];
const functions = readdirSync(resolve(root, "supabase/functions"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();
if (!functions.length) throw new Error("No Edge Functions found");
const mail =
  changed("agent-mail/") ||
  changed("skills-hub/communicate-with-") ||
  changed("skills-hub/project-management/") ||
  changed("skills-hub/execute-assignment/") ||
  files.some((file) => /^bots\/(?:cos-bot|manager-bot|worker)\/bot\.toml$/.test(file));
const artifacts =
  changed("project-context-cli/") ||
  changed("scripts/packaging/") ||
  files.includes("scripts/setup-artifacts.sh");
const selected = {
  node: node.filter(
    (component) =>
      all ||
      changed(`${component}/`) ||
      (mail && ["agent-mail", worker].includes(component)) ||
      (component === "memory-client" && changed("bots/cos-bot/")),
  ),
  python: [
    "scripts",
    ...python.filter(
      (component) =>
        all || changed(`${component}/`) || (component === "artifact-service" && artifacts),
    ),
  ],
  functions: functions.filter(
    (name) =>
      all ||
      changed(`supabase/functions/${name}/`) ||
      files.some(
        (file) =>
          file.startsWith("supabase/") &&
          !functions.some((name) => file.startsWith(`supabase/functions/${name}/`)),
      ),
  ),
  supabase: changed("supabase/") || files.includes(".github/workflows/supabase-deploy.yml"),
};
console.log(JSON.stringify(selected));
