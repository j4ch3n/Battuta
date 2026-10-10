import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  prepareWorktree,
  worktreePath,
  taskBranch,
  validateWorktreeLocation,
} from "../worktree.ts";
import type { WorkerConfig } from "../config.ts";
import { task } from "./fixtures.ts";

let root: string;
let checkout: string;
let config: WorkerConfig;
function git(...args: string[]) {
  return execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
}
beforeEach(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), "battuta trees "));
  checkout = join(root, "source checkout");
  execFileSync("git", ["init", "-b", "main", checkout]);
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "base",
  );
  config = {
    workerId: "worker-1",
    projects: { [task.project]: { checkout, baseRef: "HEAD" } },
    worktreeRoot: join(root, "trees"),
    lockPath: join(root, "lock"),
    capacity: 1,
    reconcileMs: 10000,
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("isolates shared-ticket tasks with full UUID paths and short branches, including spaces", async () => {
  const a = await prepareWorktree(task, config);
  const b = await prepareWorktree({ ...task, id: "12345678-1234-1234-1234-123456789abd" }, config);
  expect(a).not.toBe(b);
  expect(a).toBe(join(config.worktreeRoot, "demo-project-12345678-1234-1234-1234-123456789abc"));
  expect(
    execFileSync("git", ["-C", a, "branch", "--show-current"], { encoding: "utf8" }).trim(),
  ).toBe("agent/fis-40-build-useful-12345678123412341234123456789abc");
});
it("rejects a dirty existing worktree without discarding files", async () => {
  const path = await prepareWorktree(task, config);
  await writeFile(join(path, "user.txt"), "user work");
  await expect(prepareWorktree(task, config)).rejects.toThrow(/exists/);
  expect(await readFile(join(path, "user.txt"), "utf8")).toBe("user work");
});
it("rejects unrelated existing directories", async () => {
  const path = worktreePath(task, config);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "user.txt"), "preserve");
  await expect(prepareWorktree(task, config)).rejects.toThrow(/exists/);
  expect(await readFile(join(path, "user.txt"), "utf8")).toBe("preserve");
});
it("rejects branch collisions and preserves dirty checkout", async () => {
  git("branch", taskBranch(task));
  await writeFile(join(checkout, "user.txt"), "preserve");
  await expect(prepareWorktree(task, config)).rejects.toThrow(/collision/);
  expect(await readFile(join(checkout, "user.txt"), "utf8")).toBe("preserve");
});
it("rejects invalid base refs without altering checkout", async () => {
  config.projects[task.project].baseRef = "missing";
  await expect(prepareWorktree(task, config)).rejects.toThrow(/base ref/);
  expect(git("log", "--format=%s")).toBe("base");
});
it.each(["../escape", "/escape", "bad\\path"])(
  "rejects unsafe task project %s",
  async (project) => {
    config.projects[project] = config.projects[task.project];
    await expect(prepareWorktree({ ...task, project }, config)).rejects.toThrow();
  },
);
it("rejects symlink ancestors rather than following them outside the root", async () => {
  await symlink(checkout, config.worktreeRoot);
  await expect(prepareWorktree(task, config)).rejects.toThrow(/symlink/);
  expect(git("worktree", "list", "--porcelain").match(/worktree /g)).toHaveLength(1);
});
it("rejects a symlink target without overwriting it", async () => {
  await mkdir(config.worktreeRoot);
  await symlink(checkout, worktreePath(task, config));
  await expect(prepareWorktree(task, config)).rejects.toThrow(/exists|symlink/);
  expect(git("log", "--format=%s")).toBe("base");
});
it("rejects a stale registration with a missing directory", async () => {
  const path = await prepareWorktree(task, config);
  await rm(path, { recursive: true });
  await expect(prepareWorktree(task, config)).rejects.toThrow(/Stale/);
});
it("inspection rejects unrelated directories even at the expected location", async () => {
  const path = worktreePath(task, config);
  await mkdir(path, { recursive: true });
  await expect(validateWorktreeLocation(task, config, path)).rejects.toThrow(/Git/);
});
it("preserves partial creation on uncertain Git errors", async () => {
  const path = worktreePath(task, config);
  const { runGit } = await import("../config.ts");
  await expect(
    prepareWorktree(task, config, async (checkout, args) => {
      if (args[0] === "worktree" && args[1] === "add") {
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "user.txt"), "preserve uncertain work");
        throw new Error("timeout");
      }
      return runGit(checkout, args);
    }),
  ).rejects.toThrow(/uncertain/);
  expect(await readFile(join(path, "user.txt"), "utf8")).toBe("preserve uncertain work");
});
it("rejects traversal UUIDs and unknown/unowned tasks before Git mutation", async () => {
  for (const invalid of [
    { ...task, id: "../../escape" },
    { ...task, project: "unknown" },
    { ...task, claimed_by: "another" },
  ]) {
    await expect(prepareWorktree(invalid, config)).rejects.toThrow();
  }
  expect(git("worktree", "list", "--porcelain").match(/worktree /g)).toHaveLength(1);
});
it("uses a task-derived branch without a ticket and a safe fallback for non-ASCII summaries", async () => {
  const input = { ...task, ticket_id: null, instruction: { ...task.instruction, summary: "功能" } };
  const path = await prepareWorktree(input, config);
  expect(
    execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" }).trim(),
  ).toBe("agent/task-12345678123412341234123456789abc-work-12345678123412341234123456789abc");
});
