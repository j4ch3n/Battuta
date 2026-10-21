import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const taskSchema = z
  .object({
    id: z.string().min(1),
    action: z.enum(["prompt", "notify", "message", "shell"]),
    type: z.enum(["once", "interval", "cron"]),
    schedule: z.string().min(1),
    scope: z.enum(["session", "cwd", "global"]),
    status: z.enum(["pending", "running", "fired", "cancelled", "failed", "expired"]),
    enabled: z.boolean(),
  })
  .passthrough()
  .superRefine((task, ctx) => {
    const key =
      task.action === "shell" ? "command" : task.action === "prompt" ? "prompt" : "message";
    if (typeof task[key] !== "string" || !task[key].trim())
      ctx.addIssue({ code: "custom", message: `Missing ${key}` });
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
