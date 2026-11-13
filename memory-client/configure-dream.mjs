import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { atomicPrivateWrite } from "./dream-files.ts";
import { reconcileDreamSchedule } from "./dream-schedule.ts";
import { schedulerStorePath } from "./scheduler-config.ts";
import { initializeSchedulerStore, readSchedulerStore } from "./scheduler-store.ts";
import { dreamConfigSchema } from "./dream-config.ts";

// Run only during operator-invoked configuration, with the CoS stopped. Never
// edit the scheduler's store concurrently with its in-process read/modify/write.
export async function configureDream() {
  const parsed = dreamConfigSchema.safeParse({
    version: 1,
    model: process.env.BATTUTA_DREAM_MODEL,
  });
  if (!parsed.success)
    throw new Error("BATTUTA_DREAM_MODEL is required and must use provider/model-id");
  const model = parsed.data;
  const storePath = schedulerStorePath();
  const dataDirectory = process.env.BATTUTA_MEMORY_DATA_DIR ?? join(homedir(), ".battuta/memory");
  const modelPath = join(dataDirectory, "dream-config.json");
  await initializeSchedulerStore(storePath);
  const store = await readSchedulerStore(storePath);
  const result = reconcileDreamSchedule(store, new Date().toISOString());
  // The manifest-prepared project extension is discovered by Pi.
  await atomicPrivateWrite(modelPath, JSON.stringify(model, null, 2) + "\n");
  if (result !== store)
    await atomicPrivateWrite(storePath, JSON.stringify(result, null, 2) + "\n", {
      preserveParentMode: true,
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: node memory-client/configure-dream.mjs <CoS bot directory>");
  await configureDream(resolve(process.argv[2]));
}
