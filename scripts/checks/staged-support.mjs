import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
// Support group -> path prefix; a group's tests run only when its own files are staged.
const prefixes = {
  scripts: "scripts/",
  "memory-service": "memory-service/",
  "speech-service": "speech-service/",
  "artifact-service": "artifact-service/",
  "project-context-cli": "project-context-cli/",
  "doc-service": "doc-service/",
};
const staged = execFileSync("git", ["diff", "--cached", "--no-renames", "--name-only", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const groups = Object.keys(prefixes).filter((name) =>
  staged.some((file) => file.startsWith(prefixes[name])),
);
if (groups.length) {
  const result = spawnSync("node", ["scripts/checks/check-support.mjs", ...groups], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
