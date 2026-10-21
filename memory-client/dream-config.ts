import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readSchedulerStore } from "./scheduler-store.ts";
import { DREAM_JOB_ID, DREAM_JOB_NAME, ownedDreamTask } from "./dream-schedule.ts";

export const dreamConfigSchema = z
  .object({ version: z.literal(1), model: z.string().regex(/^[^/\s]+\/[^\s]+$/) })
  .strict();
export async function readDreamConfig(dataDirectory: string) {
  return dreamConfigSchema.parse(
    JSON.parse(await readFile(join(dataDirectory, "dream-config.json"), "utf8")),
  );
}
export async function enabledDreamModel(
  storePath: string,
  dataDirectory: string,
): Promise<string | undefined> {
  const store = await readSchedulerStore(storePath);
  const matching = store.tasks.filter(
    (task) => task.id === DREAM_JOB_ID || task.name === DREAM_JOB_NAME,
  );
  if (matching.length !== 1 || !ownedDreamTask(matching[0])) return;
  const job = matching[0];
  if (!job.enabled || !["pending", "running"].includes(job.status)) return;
  return (await readDreamConfig(dataDirectory)).model;
}
