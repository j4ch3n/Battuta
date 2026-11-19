import { expect, test } from "vitest";
import { guardWorktreeCommand } from "../worktree-guard.ts";

test.each([
  ["git worktree add ../x/fix-login", "battuta-project worktree create atlas fix-login"],
  [
    "git worktree add -b feat/login ~/wt/fix-login main",
    "battuta-project worktree create atlas fix-login --branch feat/login --base main",
  ],
  [
    "git -C /repo worktree remove /somewhere/fix-login",
    "battuta-project worktree delete atlas fix-login",
  ],
  [
    "git worktree remove --force fix-login",
    "battuta-project worktree delete atlas fix-login --force",
  ],
  ["git worktree list", "battuta-project worktree list atlas"],
])("rewrites %s", (command, rewrite) => {
  expect(guardWorktreeCommand(command, "atlas")).toEqual({ rewrite });
});

test("quotes a project name that is not a plain word", () => {
  expect(guardWorktreeCommand("git worktree list", "My App")).toEqual({
    rewrite: "battuta-project worktree list 'My App'",
  });
});

test.each([
  "git worktree prune",
  "git worktree move a b",
  "git worktree add --detach ../x/fix-login",
  "git worktree add ../x/Bad_Name",
  "git worktree list --porcelain",
  "cd repo && git worktree add ../x/fix-login",
  "git worktree add ../x/fix-login; rm -rf /",
  "git worktree add $(pwd)/fix-login",
  'git worktree add "../x/fix-login"',
])("blocks %s", (command) => {
  expect(guardWorktreeCommand(command, "atlas")).toMatchObject({
    block: expect.any(String) as string,
  });
  expect(JSON.stringify(guardWorktreeCommand(command, "atlas"))).toContain(
    "battuta-project worktree",
  );
});

test("blocks when the session has no project", () => {
  expect(guardWorktreeCommand("git worktree list", undefined)).toHaveProperty("block");
});

test.each(["git status", "git log --oneline", "ls worktrees", "git commit -m 'worktree notes'"])(
  "ignores %s",
  (command) => {
    expect(guardWorktreeCommand(command, "atlas")).toBeUndefined();
  },
);
