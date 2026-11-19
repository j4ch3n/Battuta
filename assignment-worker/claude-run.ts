import { spawn } from "node:child_process";
import { Type } from "typebox";
import { delegationCatalog, type Tier } from "./delegation.ts";
import { resolveDelegationCwd, type DelegationCwd, type GitRunner } from "./delegation-cwd.ts";

export type ClaudePermission = "readonly" | "edit";

/** Parameters of the `delegate_claude_assignment` tool. The worktree is optional and comes from the assignment brief. */
export const DelegateClaudeParams = Type.Object(
  {
    task: Type.String({
      minLength: 1,
      pattern: "\\S",
      description: "The complete task for this Claude Code run.",
    }),
    tier: Type.Union([Type.Literal("economy"), Type.Literal("balanced"), Type.Literal("max")], {
      description: "Model tier from the delegation-models section of the prompt.",
    }),
    permission: Type.Union([Type.Literal("readonly"), Type.Literal("edit")], {
      description:
        "readonly runs in plan mode; edit allows file edits (acceptEdits). Danger is not available.",
    }),
    worktree: Type.Optional(
      Type.String({
        description:
          "Absolute path of a git worktree of this project's repository. Pass only when the assignment brief supplies one; omit to run in the project code folder.",
      }),
    ),
  },
  { additionalProperties: false },
);

/** Claude Code permission modes, as in pi-harness-delegate's claude harness (readonly->plan, edit->acceptEdits). */
const PERMISSION_MODE: Record<ClaudePermission, string> = { readonly: "plan", edit: "acceptEdits" };

/** Same default timeout as pi-harness-delegate (10 minutes). */
export const CLAUDE_RUN_TIMEOUT_MS = 600_000;

/** Collected stdout above this size stops the run with an error instead of growing without limit. */
export const MAX_CLAUDE_STDOUT_BYTES = 16 * 1024 * 1024;

export interface ClaudeProcessRequest {
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ClaudeProcessOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs the `claude` binary; injectable so tests never start a real Claude Code process. */
export type ClaudeProcessRunner = (request: ClaudeProcessRequest) => Promise<ClaudeProcessOutcome>;

export const spawnClaude: ClaudeProcessRunner = (request) =>
  new Promise((resolve, reject) => {
    if (request.signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const proc = spawn("claude", request.args, {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      proc.kill("SIGKILL");
      finish(() => reject(new Error("cancelled")));
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() => reject(new Error(`claude timed out after ${request.timeoutMs}ms`)));
    }, request.timeoutMs);
    timer.unref?.();
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CLAUDE_STDOUT_BYTES) {
        proc.kill("SIGKILL");
        finish(() =>
          reject(
            new Error(
              `claude stdout exceeded ${MAX_CLAUDE_STDOUT_BYTES} bytes; the run was stopped`,
            ),
          ),
        );
        return;
      }
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("error", (error) =>
      finish(() => reject(new Error(`failed to start claude: ${error.message}`))),
    );
    proc.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));
    request.signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Claude Code CLI arguments for a headless stream-json run, mirroring pi-harness-delegate's claude harness. */
export function buildClaudeArgs(input: {
  prompt: string;
  permission: ClaudePermission;
  model: string;
}) {
  return [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    PERMISSION_MODE[input.permission],
    "--model",
    input.model,
  ];
}

export interface ClaudeResultSummary {
  text: string;
  isError: boolean;
  sessionId: string | null;
  totalCostUsd: number | null;
  numTurns: number | null;
  permissionDenials: unknown[];
}

/** Reads the final `result` event from stream-json output; undefined when the run produced none. */
export function parseClaudeResult(stdout: string): ClaudeResultSummary | undefined {
  let found: ClaudeResultSummary | undefined;
  for (const line of stdout.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof event !== "object" ||
      event === null ||
      (event as { type?: unknown }).type !== "result"
    )
      continue;
    const o = event as Record<string, unknown>;
    found = {
      text: typeof o.result === "string" ? o.result : "",
      isError: o.is_error === true,
      sessionId: typeof o.session_id === "string" ? o.session_id : null,
      totalCostUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : null,
      numTurns: typeof o.num_turns === "number" ? o.num_turns : null,
      permissionDenials: Array.isArray(o.permission_denials) ? o.permission_denials : [],
    };
  }
  return found;
}

/** The configured Claude model for a tier, from the worker environment catalog (see delegation.ts). */
export function modelForTier(tier: Tier, env: Record<string, string | undefined>): string {
  const entry = delegationCatalog(env).find((candidate) => candidate.tier === tier);
  if (!entry || "error" in entry)
    throw new Error(
      `Delegation cannot start: tier "${tier}" has no configured model${entry ? ` (${entry.error})` : ""}`,
    );
  return entry.model;
}

export interface ClaudeDelegationInput {
  project: string;
  task: string;
  tier: Tier;
  permission: ClaudePermission;
  worktree?: string;
  signal?: AbortSignal;
}

export interface ClaudeDelegationDeps {
  projectsRoot: string;
  env: Record<string, string | undefined>;
  runner?: ClaudeProcessRunner;
  git?: GitRunner;
}

export interface ClaudeDelegationReport extends ClaudeResultSummary {
  cwd: string;
  source: DelegationCwd["source"];
}

/**
 * Starts one worker-assigned Claude Code run. The working directory is resolved and validated before the
 * process is spawned; any failure throws without spawning. Claude runs with that directory as its cwd.
 */
export async function delegateClaudeForAssignment(
  input: ClaudeDelegationInput,
  deps: ClaudeDelegationDeps,
): Promise<ClaudeDelegationReport> {
  const location = await resolveDelegationCwd({
    project: input.project,
    worktree: input.worktree,
    projectsRoot: deps.projectsRoot,
    git: deps.git,
  });
  const model = modelForTier(input.tier, deps.env);
  const prompt = [
    `You are completing one delegated task for the project "${input.project}".`,
    `Working directory: ${location.cwd} (${location.source === "worktree" ? "assignment worktree" : "project code folder"}).`,
    "",
    "Task:",
    input.task,
  ].join("\n");
  const args = buildClaudeArgs({ prompt, permission: input.permission, model });
  const runner = deps.runner ?? spawnClaude;
  const outcome = await runner({
    args,
    cwd: location.cwd,
    timeoutMs: CLAUDE_RUN_TIMEOUT_MS,
    signal: input.signal,
  });
  const result = parseClaudeResult(outcome.stdout);
  if (!result) {
    const detail = outcome.stderr.trim() || `exit code ${outcome.code}`;
    throw new Error(`claude finished without a result in ${location.cwd}: ${detail}`);
  }
  if (outcome.code !== 0)
    throw new Error(
      `claude exited with code ${outcome.code} in ${location.cwd} (session ${result.sessionId ?? "unknown"}): ${outcome.stderr.trim() || result.text}`,
    );
  if (result.isError)
    throw new Error(
      `claude reported an error in ${location.cwd} (session ${result.sessionId ?? "unknown"}): ${result.text}`,
    );
  return { ...result, cwd: location.cwd, source: location.source };
}
