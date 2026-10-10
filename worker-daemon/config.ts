import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface WorkerConfig {
  workerId: string;
  projects: Record<string, { checkout: string; baseRef: string }>;
  worktreeRoot: string;
  lockPath: string;
  capacity: number;
  reconcileMs: number;
  model?: { providerID: string; modelID: string };
}
export type Git = (checkout: string, args: string[]) => Promise<string>;
const execute = promisify(execFile);
export const runGit: Git = async (checkout, args) => {
  const result = await execute("git", ["-C", checkout, ...args], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
};
export function safeIdentifier(value: string): boolean {
  return (
    !!value.trim() &&
    value.length <= 128 &&
    !/[\\/]/u.test(value) &&
    !hasControl(value) &&
    !value.includes("..")
  );
}
function hasControl(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function absolute(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value) && !value.includes("\0");
}
export async function verifyCheckout(
  checkout: string,
  baseRef: string,
  git: Git = runGit,
): Promise<void> {
  if (!absolute(checkout) || !baseRef.trim() || baseRef.startsWith("-") || hasControl(baseRef))
    throw new Error("Invalid checkout or base ref");
  if ((await git(checkout, ["rev-parse", "--is-inside-work-tree"])) !== "true")
    throw new Error("Invalid checkout");
  try {
    await git(checkout, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  } catch {
    throw new Error("Invalid base ref");
  }
}
export async function loadConfig(path: string): Promise<WorkerConfig> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !record(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            "workerId",
            "projects",
            "worktreeRoot",
            "lockPath",
            "capacity",
            "reconcileMs",
            "model",
          ].includes(key),
      )
    )
      throw new Error();
    if (
      typeof value.workerId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.workerId) ||
      !absolute(value.worktreeRoot) ||
      !record(value.projects) ||
      !Object.keys(value.projects).length
    )
      throw new Error();
    const capacity = value.capacity ?? 1;
    const reconcileMs = value.reconcileMs ?? 10000;
    if (
      typeof capacity !== "number" ||
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      typeof reconcileMs !== "number" ||
      !Number.isSafeInteger(reconcileMs) ||
      reconcileMs < 1000
    )
      throw new Error();
    const projects: WorkerConfig["projects"] = Object.create(null) as WorkerConfig["projects"];
    for (const [key, project] of Object.entries(value.projects)) {
      if (
        !safeIdentifier(key) ||
        !record(project) ||
        Object.keys(project).sort().join(",") !== "baseRef,checkout" ||
        !absolute(project.checkout) ||
        typeof project.baseRef !== "string"
      )
        throw new Error();
      await verifyCheckout(project.checkout, project.baseRef);
      projects[key] = { checkout: project.checkout, baseRef: project.baseRef };
    }
    let model: WorkerConfig["model"];
    if (value.model !== undefined) {
      if (
        !record(value.model) ||
        Object.keys(value.model).sort().join(",") !== "modelID,providerID" ||
        typeof value.model.providerID !== "string" ||
        !value.model.providerID.trim() ||
        typeof value.model.modelID !== "string" ||
        !value.model.modelID.trim()
      )
        throw new Error();
      model = { providerID: value.model.providerID, modelID: value.model.modelID };
    }
    // All workers addressing one task environment share a lock, regardless of capacity/identity.
    const environment = createHash("sha256")
      .update(process.env.SUPABASE_URL ?? "unconfigured")
      .digest("hex")
      .slice(0, 24);
    const lockPath = value.lockPath ?? join(homedir(), ".battuta", "worker", `${environment}.lock`);
    if (!absolute(lockPath)) throw new Error();
    return {
      workerId: value.workerId,
      projects,
      worktreeRoot: value.worktreeRoot,
      lockPath,
      capacity,
      reconcileMs,
      ...(model ? { model } : {}),
    };
  } catch {
    throw new Error("Invalid worker configuration: check paths, Git refs and non-secret settings");
  }
}
