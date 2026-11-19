import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  buildClaudeArgs,
  delegateClaudeForAssignment,
  MAX_CLAUDE_STDOUT_BYTES,
  modelForTier,
  parseClaudeResult,
  spawnClaude,
  type ClaudeProcessRunner,
  type ClaudeDelegationInput,
} from "../claude-run.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

const env = {
  MODEL_FOR_EASY_TASKS: "anthropic/claude-economy-x",
  MODEL_FOR_MEDIUM_TASKS: "anthropic/claude-balanced-x",
  MODEL_FOR_HARD_TASKS: "anthropic/claude-max-x",
};
const resultLine = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "finished",
  session_id: "session-1",
  total_cost_usd: 0.01,
  num_turns: 2,
  permission_denials: [],
});

let fixture: ProjectsFixture;
beforeEach(async () => {
  fixture = await createProjectsFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.dispose();
});

function recordingRunner(stdout = `${resultLine}\n`) {
  return vi.fn<ClaudeProcessRunner>(() => Promise.resolve({ stdout, stderr: "", code: 0 }));
}

function input(overrides: Partial<ClaudeDelegationInput> = {}): ClaudeDelegationInput {
  return {
    project: "atlas",
    task: "Summarize the README.",
    tier: "economy",
    permission: "readonly",
    ...overrides,
  };
}

test("a code-folder run spawns claude with the project's code folder as cwd", async () => {
  const runner = recordingRunner();
  const report = await delegateClaudeForAssignment(input(), {
    projectsRoot: fixture.projectsRoot,
    env,
    runner,
  });
  expect(runner).toHaveBeenCalledTimes(1);
  const request = runner.mock.calls[0][0];
  expect(request.cwd).toBe(fixture.atlasCode);
  expect(request.args).toEqual(
    expect.arrayContaining(["-p", "--permission-mode", "plan", "--model", "claude-economy-x"]),
  );
  expect(request.args[1]).toContain(
    `Working directory: ${fixture.atlasCode} (project code folder).`,
  );
  expect(report).toEqual({
    text: "finished",
    isError: false,
    sessionId: "session-1",
    totalCostUsd: 0.01,
    numTurns: 2,
    permissionDenials: [],
    cwd: fixture.atlasCode,
    source: "code-folder",
  });
});

test("a supplied worktree becomes the spawned cwd, with edit permission and the balanced model", async () => {
  const runner = recordingRunner();
  const report = await delegateClaudeForAssignment(
    input({ worktree: fixture.atlasWorktree, tier: "balanced", permission: "edit" }),
    { projectsRoot: fixture.projectsRoot, env, runner },
  );
  const request = runner.mock.calls[0][0];
  expect(request.cwd).toBe(fixture.atlasWorktree);
  expect(request.args).toEqual(
    expect.arrayContaining(["--permission-mode", "acceptEdits", "--model", "claude-balanced-x"]),
  );
  expect(request.args).not.toContain("--add-dir");
  expect(report.source).toBe("worktree");
  expect(report.cwd).toBe(fixture.atlasWorktree);
});

test("an unresolvable project fails before any process is spawned", async () => {
  const runner = recordingRunner();
  await expect(
    delegateClaudeForAssignment(input({ project: "nosuch" }), {
      projectsRoot: fixture.projectsRoot,
      env,
      runner,
    }),
  ).rejects.toThrow('Delegation cannot start: project "nosuch" has no registered folder');
  expect(runner).not.toHaveBeenCalled();
});

test.each([
  ["an absolute path that is not a git checkout", { worktree: "/" }],
  ["a worktree that is not an absolute path", { worktree: "relative" }],
])("%s fails before any process is spawned", async (_label, overrides) => {
  const runner = recordingRunner();
  await expect(
    delegateClaudeForAssignment(input(overrides), {
      projectsRoot: fixture.projectsRoot,
      env,
      runner,
    }),
  ).rejects.toThrow("Delegation cannot start");
  expect(runner).not.toHaveBeenCalled();
});

test("a worktree of another project's repository fails before any process is spawned", async () => {
  const runner = recordingRunner();
  await expect(
    delegateClaudeForAssignment(input({ worktree: fixture.bravoWorktree }), {
      projectsRoot: fixture.projectsRoot,
      env,
      runner,
    }),
  ).rejects.toThrow('belongs to a different repository than project "atlas"');
  expect(runner).not.toHaveBeenCalled();
});

test("a tier without a configured model fails before any process is spawned", async () => {
  const runner = recordingRunner();
  await expect(
    delegateClaudeForAssignment(input({ tier: "max" }), {
      projectsRoot: fixture.projectsRoot,
      env: { MODEL_FOR_EASY_TASKS: env.MODEL_FOR_EASY_TASKS },
      runner,
    }),
  ).rejects.toThrow('tier "max" has no configured model');
  expect(runner).not.toHaveBeenCalled();
});

test("a run that emits no result reports its stderr and never reports success", async () => {
  const runner = vi.fn<ClaudeProcessRunner>(() =>
    Promise.resolve({ stdout: "", stderr: "auth failed", code: 1 }),
  );
  await expect(
    delegateClaudeForAssignment(input(), { projectsRoot: fixture.projectsRoot, env, runner }),
  ).rejects.toThrow(`claude finished without a result in ${fixture.atlasCode}: auth failed`);
});

test("a non-zero exit is a failure even when a result event was parsed", async () => {
  const runner = vi.fn<ClaudeProcessRunner>(() =>
    Promise.resolve({ stdout: `${resultLine}\n`, stderr: "boom", code: 2 }),
  );
  await expect(
    delegateClaudeForAssignment(input(), { projectsRoot: fixture.projectsRoot, env, runner }),
  ).rejects.toThrow(`claude exited with code 2 in ${fixture.atlasCode} (session session-1): boom`);
});

test("stdout above the collection cap stops the run with a clear error", async () => {
  const bin = await fs.mkdtemp(join(fixture.home, "big-bin-"));
  const script = join(bin, "claude");
  await fs.writeFile(script, `#!/bin/sh\nhead -c ${MAX_CLAUDE_STDOUT_BYTES + 1024} /dev/zero\n`, {
    mode: 0o755,
  });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
  await expect(
    spawnClaude({ args: [], cwd: fixture.atlasCode, timeoutMs: 60_000 }),
  ).rejects.toThrow(`claude stdout exceeded ${MAX_CLAUDE_STDOUT_BYTES} bytes; the run was stopped`);
});

test("a run that reports is_error is surfaced as an error with its session", async () => {
  const errorLine = JSON.stringify({
    type: "result",
    is_error: true,
    result: "budget spent",
    session_id: "s-2",
  });
  await expect(
    delegateClaudeForAssignment(input(), {
      projectsRoot: fixture.projectsRoot,
      env,
      runner: recordingRunner(`${errorLine}\n`),
    }),
  ).rejects.toThrow("claude reported an error");
});

test("the default spawner runs the claude binary with the resolved cwd (fake binary, no Claude)", async () => {
  const bin = await fs.mkdtemp(join(fixture.home, "fake-bin-"));
  const script = join(bin, "claude");
  // A stand-in for the claude CLI: it reports its own working directory as the result text.
  await fs.writeFile(
    script,
    `#!/bin/sh\nprintf '{"type":"result","is_error":false,"result":"%s"}\\n' "$(pwd -P)"\n`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
  const report = await delegateClaudeForAssignment(input({ worktree: fixture.atlasWorktree }), {
    projectsRoot: fixture.projectsRoot,
    env,
  });
  expect(report.text).toBe(fixture.atlasWorktree);
  const codeReport = await delegateClaudeForAssignment(input(), {
    projectsRoot: fixture.projectsRoot,
    env,
  });
  expect(codeReport.text).toBe(fixture.atlasCode);
});

test("the claude command line follows the readonly/edit permission map and carries no add-dir", () => {
  expect(buildClaudeArgs({ prompt: "p", permission: "readonly", model: "m" })).toEqual([
    "-p",
    "p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "plan",
    "--model",
    "m",
  ]);
  expect(buildClaudeArgs({ prompt: "p", permission: "edit", model: "m" })).toContain("acceptEdits");
});

test("parseClaudeResult ignores non-JSON lines and reads the final result event", () => {
  expect(parseClaudeResult(`noise\n{"type":"assistant"}\n${resultLine}\n`)?.sessionId).toBe(
    "session-1",
  );
  expect(parseClaudeResult("no result here")).toBeUndefined();
});

test("modelForTier reads the anthropic model for each tier", () => {
  expect(modelForTier("max", env)).toBe("claude-max-x");
  expect(() => modelForTier("economy", { MODEL_FOR_EASY_TASKS: "openai/gpt" })).toThrow(
    'tier "economy" has no configured model (MODEL_FOR_EASY_TASKS must be anthropic/<model-id>)',
  );
});
