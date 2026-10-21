import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function schedulerStorePath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const path = env.PI_SCHEDULER_STATE_FILE ?? join(home, ".battuta", "schedule-prompts.json");
  if (!path.trim() || !isAbsolute(path))
    throw new Error("PI_SCHEDULER_STATE_FILE must be an absolute file path");
  return path;
}

export function schedulerCatchUpMax(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.PI_SCHEDULER_CATCHUP_MAX ?? "0";
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("PI_SCHEDULER_CATCHUP_MAX must be a nonnegative integer");
  return value;
}
