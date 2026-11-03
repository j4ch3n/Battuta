import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  unlink,
  readFile,
  copyFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const cli = resolve(import.meta.dirname, "../skills.mjs");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "battuta-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = join(root, "skills-hub");
  for (const name of ["memory", "note-taking"]) {
    await mkdir(join(hub, name), { recursive: true });
    await writeFile(join(hub, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  }
  const manifest = join(root, "bots/example/skills.json");
  await mkdir(join(root, "bots/example"), { recursive: true });
  await writeFile(manifest, JSON.stringify({ skills: ["memory", "note-taking"] }));
  return { root, hub, manifest };
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("selection returns ordered names and accepts empty selections", async (t) => {
  const { root, hub, manifest } = await fixture(t);
  for (const skills of [["note-taking", "memory"], []]) {
    await writeFile(manifest, JSON.stringify({ skills }));
    const result = run(root, manifest, hub);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), skills);
  }
});

for (const [label, data] of [
  ["malformed", "{"],
  ["null", "null"],
  ["array", "[]"],
  ["missing field", "{}"],
  ["unknown key", '{"skills":[],"role":"pm"}'],
  ["non-array", '{"skills":"memory"}'],
  ["non-string", '{"skills":[1]}'],
  ["duplicate", '{"skills":["memory","memory"]}'],
  ["unknown", '{"skills":["missing"]}'],
  ["traversal", '{"skills":["../memory"]}'],
  ["absolute", '{"skills":["/memory"]}'],
  ["uppercase", '{"skills":["Memory"]}'],
]) {
  test(`rejects ${label} selections`, async (t) => {
    const { root, manifest, hub } = await fixture(t);
    await writeFile(manifest, data);
    const result = run(root, manifest, hub);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid skill|Missing skill/);
    assert.equal(result.stdout, "");
  });
}

test("rejects missing entry points and escaping catalog links", async (t) => {
  const { root, manifest, hub } = await fixture(t);
  await unlink(join(hub, "memory/SKILL.md"));
  assert.notEqual(run(root, manifest, hub).status, 0);
  await writeFile(join(root, "outside.md"), "external");
  await symlink(join(root, "outside.md"), join(hub, "memory/SKILL.md"));
  assert.notEqual(run(root, manifest, hub).status, 0);
});

test("all-profile check validates unshipped worker selections", async (t) => {
  const { root } = await fixture(t);
  assert.equal(run(root, "--check").status, 0);
  await mkdir(join(root, "bots/worker"));
  await writeFile(join(root, "bots/worker/skills.json"), '{"skills":["missing"]}');
  assert.notEqual(run(root, "--check").status, 0);
});

test("staged check uses index content and rejects staged entry-point deletion", async (t) => {
  const { root, manifest, hub } = await fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("add", ".");
  await writeFile(manifest, '{"skills":["missing"]}');
  assert.equal(run(root, "--check", "--staged").status, 0);
  git("add", ".");
  await writeFile(manifest, '{"skills":["memory"]}');
  assert.notEqual(run(root, "--check", "--staged").status, 0);
  git("add", ".");
  await unlink(join(hub, "memory/SKILL.md"));
  git("add", ".");
  await writeFile(join(hub, "memory/SKILL.md"), "unstaged repair");
  assert.notEqual(run(root, "--check", "--staged").status, 0);
});

test("real commit hook and release gate block invalid selections", async (t) => {
  const { root, manifest } = await fixture(t);
  const repository = resolve(import.meta.dirname, "../..");
  const config = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: config.scripts }));
  await mkdir(join(root, "bot-setup"));
  await copyFile(cli, join(root, "bot-setup/skills.mjs"));
  await mkdir(join(root, "node_modules/.bin"), { recursive: true });
  const nextTask = join(root, "node_modules/.bin/lint-staged");
  await writeFile(nextTask, "#!/bin/sh\necho ran > next-task\n");
  await chmod(nextTask, 0o755);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("add", "bots", "skills-hub");
  const hook = join(repository, ".husky/pre-commit");
  const invokeHook = () => spawnSync("bash", [hook], { cwd: root, encoding: "utf8" });
  let result = invokeHook();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, "next-task"), "utf8"), "ran\n");
  await unlink(join(root, "next-task"));
  await writeFile(manifest, '{"skills":["missing"]}');
  git("add", "bots");
  result = invokeHook();
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(join(root, "next-task")), { code: "ENOENT" });
  const workflow = await readFile(join(repository, ".github/workflows/release.yml"), "utf8");
  const command = workflow.match(/name: Validate skill manifests\s+run: (.+)/)?.[1];
  assert.ok(command);
  result = spawnSync(command, { shell: true, cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  await writeFile(manifest, '{"skills":["memory"]}');
  result = spawnSync(command, { shell: true, cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
