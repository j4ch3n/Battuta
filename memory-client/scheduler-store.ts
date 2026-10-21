import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";

// Reuse the pinned upstream parser instead of maintaining another scheduling grammar.
const native = createRequire(import.meta.url)(
  "@jl1990/pi-scheduler/extensions/scheduler/scheduler-core.cjs",
) as {
  validateTaskSchedule: (type: string, schedule: string, now: Date) => { intervalMs?: number };
  normalizeBackoff: (value: unknown, intervalMs: number | undefined, now: Date) => unknown;
};
const timestamp = z.string().datetime({ offset: true });

const taskSchema = z
  .object({
    id: z.string().min(1),
    action: z.enum(["prompt", "notify", "message", "shell"]),
    type: z.enum(["once", "interval", "cron"]),
    schedule: z.string().min(1),
    scope: z.enum(["session", "cwd", "global"]),
    status: z.enum(["pending", "running", "fired", "cancelled", "failed", "expired"]),
    enabled: z.boolean(),
    cwd: z.string().min(1).optional(),
    sessionFile: z.string().min(1).optional(),
    createdAt: timestamp.optional(),
    dueAt: timestamp.optional(),
    nextRun: timestamp.optional(),
    expiresAt: timestamp.optional(),
    startedAt: timestamp.optional(),
    lastRun: timestamp.optional(),
    completedAt: timestamp.optional(),
    cancelledAt: timestamp.optional(),
    disabledAt: timestamp.optional(),
    expiredAt: timestamp.optional(),
    maxRuns: z.number().int().positive().optional(),
    runCount: z.number().int().nonnegative().optional(),
    intervalMs: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    wakeOn: z.enum(["always", "failure", "success", "never", "change"]).optional(),
    stopOn: z.enum(["success", "failure", "never"]).optional(),
    lastStatus: z.enum(["success", "error", "running"]).optional(),
    triggerTurn: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((task, ctx) => {
    const key =
      task.action === "shell" ? "command" : task.action === "prompt" ? "prompt" : "message";
    if (typeof task[key] !== "string" || !task[key].trim())
      ctx.addIssue({ code: "custom", message: `Missing ${key}` });
    if ((task.scope === "session" && !task.sessionFile) || (task.scope === "cwd" && !task.cwd))
      ctx.addIssue({ code: "custom", message: "Missing scheduler scope binding" });
    try {
      // Completed/overdue absolute one-shots remain valid on later startups.
      const absolute = task.type === "once" ? Date.parse(task.schedule) : Number.NaN;
      const now = Number.isFinite(absolute)
        ? new Date(absolute - 1)
        : task.type === "once" && task.createdAt
          ? new Date(task.createdAt)
          : new Date();
      const schedule = native.validateTaskSchedule(task.type, task.schedule, now);
      if (task.backoff !== undefined)
        native.normalizeBackoff(task.backoff, schedule.intervalMs, now);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid native scheduler schedule or backoff" });
    }
  });
const storeSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string().datetime().optional(),
    tasks: z.array(taskSchema),
  })
  .passthrough()
  .superRefine((store, ctx) => {
    if (new Set(store.tasks.map((task) => task.id)).size !== store.tasks.length)
      ctx.addIssue({ code: "custom", message: "Duplicate scheduler task IDs" });
  });
export type SchedulerStore = z.infer<typeof storeSchema>;

export async function readSchedulerStore(path: string): Promise<SchedulerStore> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("Scheduler store must be a regular file");
  return storeSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

// Setup only, PM stopped. Never overwrite or automatically import an old store.
export async function initializeSchedulerStore(path: string): Promise<void> {
  try {
    await readSchedulerStore(path);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await readSchedulerStore(path);
    return;
  }
  try {
    await file.writeFile(JSON.stringify({ version: 2, revision: 0, tasks: [] }, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}
