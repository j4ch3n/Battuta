import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SubagentDelegationTerminalResponse } from "pi-subagents/delegation";
import { prepareWorkspace, type Config, type Profile } from "./policy.ts";

export function childEnvironment(root: string, agentDir: string, key: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    TMPDIR: root,
    PATH: dirname(process.execPath),
    PI_CODING_AGENT_DIR: agentDir,
    BATTUTA_CHILD_API_KEY: key,
  };
}

export interface Task {
  profile: string;
  objective: string;
  inputs: string[];
  writable?: string[];
  scope: string;
  evidence: string;
}
type Evidence = Omit<SubagentDelegationTerminalResponse, "usage"> & {
  usage?: Omit<NonNullable<SubagentDelegationTerminalResponse["usage"]>, "cost"> & { cost: null };
};
export interface Job {
  id: string;
  profile: Profile;
  objective: string;
  workspace: string;
  status: "running" | "completed" | "failed" | "cancelled" | "timed_out";
  pid?: number;
  result?: Evidence;
  error?: string;
}
interface Owned {
  job: Job;
  root: string;
  settled: boolean;
  done: Promise<void>;
  stop: (status: "cancelled" | "timed_out" | "failed") => void;
}

export class Runtime {
  private jobs = new Map<string, Owned>();
  private closed = false;
  constructor(
    private config: Config,
    private env: NodeJS.ProcessEnv = process.env,
  ) {}
  start(tasks: Task[]): Job[] {
    if (this.closed) throw new Error("Subagent runtime is shutdown");
    if (
      !tasks.length ||
      tasks.length + [...this.jobs.values()].filter(({ settled }) => !settled).length >
        this.config.concurrency
    )
      throw new Error("Subagent capacity exceeded");
    if (this.jobs.size + tasks.length > this.config.maxSpawns)
      throw new Error("Session spawn budget exhausted");
    for (const task of tasks) {
      if (
        !["scout", "worker", "reviewer"].includes(task.profile) ||
        [task.objective, task.scope, task.evidence].some(
          (s) => typeof s !== "string" || !s.trim() || s.length > 16000,
        )
      )
        throw new Error("Task needs profile, objective, inputs, scope and expected evidence");
      if (
        !Array.isArray(task.inputs) ||
        task.inputs.length > 64 ||
        task.inputs.some((path) => !this.config.inputs.includes(path))
      )
        throw new Error("Task input exceeds operator grant");
      if (
        task.writable !== undefined &&
        (!Array.isArray(task.writable) ||
          task.writable.length > 64 ||
          task.writable.some((path) => !this.config.writable.includes(path)))
      )
        throw new Error("Task write exceeds operator grant");
      if (task.profile !== "worker" && task.writable?.length)
        throw new Error("Read-only profiles cannot request writable paths");
    }
    const key = this.env[this.config.apiKeyEnv];
    if (!key) throw new Error(`Missing dedicated child credential: ${this.config.apiKeyEnv}`);
    // Prepare the entire batch before admitting any process.
    const roots: string[] = [];
    try {
      for (const task of tasks)
        roots.push(
          prepareWorkspace({ ...this.config, inputs: task.inputs }, task.profile as Profile),
        );
    } catch (error) {
      roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
      throw error;
    }
    return tasks.map((task, index) => this.launch(task, roots[index], key));
  }
  private launch(task: Task, root: string, key: string): Job {
    const work = join(root, "work");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { mode: 0o700 });
    const job: Job = {
      id: randomUUID(),
      profile: task.profile as Profile,
      objective: task.objective,
      workspace: work,
      status: "running",
    };
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./broker.ts", import.meta.url))],
      {
        cwd: work,
        detached: true,
        stdio: ["pipe", "ignore", "ignore", "ipc"],
        env: childEnvironment(root, agentDir, key),
      },
    );
    job.pid = child.pid;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    };
    const stop = (status: "cancelled" | "timed_out" | "failed") => {
      if (job.status !== "running") return;
      job.status = status;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), 250);
    };
    let terminal: SubagentDelegationTerminalResponse | undefined;
    child.on("message", (value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        Buffer.byteLength(JSON.stringify(value)) > 131072
      ) {
        job.error = "Invalid or oversized child result";
        stop("failed");
        return;
      }
      terminal = value as SubagentDelegationTerminalResponse;
    });
    child.on("error", (error) => {
      job.error = error.message;
    });
    child.stdin?.on("error", () => {
      /* spawn errors are reported by close */
    });
    const done = new Promise<void>((resolve) =>
      child.once("close", (code) => {
        this.jobs.get(job.id)!.settled = true;
        clearTimeout(deadline);
        clearTimeout(killTimer);
        if (terminal) {
          const { usage, ...evidence } = terminal;
          // Upstream also normalizes missing successful-stream usage to zeros.
          // Without an availability flag, all-zero counters are unverifiable.
          job.result = {
            ...evidence,
            ...(usage &&
            terminal.status === "completed" &&
            [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(
              (n) => Number.isFinite(n) && n >= 0,
            ) &&
            [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].some((n) => n > 0)
              ? { usage: { ...usage, cost: null } }
              : {}),
          };
        }
        if (job.status === "running") {
          job.status =
            code === 0 && terminal?.status === "completed"
              ? "completed"
              : terminal?.status === "timed_out"
                ? "timed_out"
                : "failed";
          if (!terminal) job.error ??= `Child exited without terminal evidence (exit ${code})`;
        }
        resolve();
      }),
    );
    const deadline = setTimeout(() => stop("timed_out"), this.config.timeoutMs);
    this.jobs.set(job.id, { job, root, settled: false, done, stop });
    child.stdin?.end(
      JSON.stringify({
        id: job.id,
        task,
        config: {
          inputs: task.inputs,
          writable: task.writable ?? [],
          model: this.config.model,
          baseUrl: this.config.baseUrl,
          timeoutMs: this.config.timeoutMs,
        },
      }),
    );
    return structuredClone(job);
  }
  status(ids?: string[]): Job[] {
    return (ids ?? [...this.jobs.keys()]).map((id) => {
      const owned = this.jobs.get(id);
      if (!owned) throw new Error(`Unknown child: ${id}`);
      return structuredClone(owned.job);
    });
  }
  async wait(ids: string[]): Promise<Job[]> {
    this.status(ids);
    await Promise.all(ids.map((id) => this.jobs.get(id)!.done));
    return this.status(ids);
  }
  cancel(id: string): void {
    const owned = this.jobs.get(id);
    if (!owned) throw new Error(`Unknown child: ${id}`);
    owned.stop("cancelled");
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const owned of this.jobs.values()) owned.stop("cancelled");
    await Promise.all([...this.jobs.values()].map((owned) => owned.done));
    for (const owned of this.jobs.values()) rmSync(owned.root, { recursive: true, force: true });
  }
}
