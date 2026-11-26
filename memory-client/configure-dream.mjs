import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicPrivateWrite } from "./dream-files.ts";
import { reconcileDreamSchedule } from "./dream-schedule.ts";
import { schedulerStorePath } from "./scheduler-config.ts";
import { initializeSchedulerStore, readSchedulerStore } from "./scheduler-store.ts";
import { lstat } from "node:fs/promises";

// Run only during operator-invoked configuration, with the CoS stopped. Never
// edit the scheduler's store concurrently with its in-process read/modify/write.
export async function configureDream(_directory, { release = false } = {}) {
  const storePath = schedulerStorePath();
  if (release) {
    for (const path of [dirname(storePath), storePath]) {
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || (path === storePath ? !info.isFile() : !info.isDirectory()))
          throw new Error(`Unsafe release destination: ${path}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const initial = reconcileDreamSchedule(
      { version: 2, revision: 0, tasks: [] },
      new Date().toISOString(),
    );
    const created = await atomicPrivateWrite(storePath, JSON.stringify(initial, null, 2) + "\n", {
      createOnly: true,
      preserveParentMode: true,
    });
    if (!created && !(await lstat(storePath)).isFile())
      throw new Error(`Expected regular file: ${storePath}`);
    console.log(JSON.stringify([{ path: storePath, created }]));
    return;
  }
  await initializeSchedulerStore(storePath);
  const store = await readSchedulerStore(storePath);
  const result = reconcileDreamSchedule(store, new Date().toISOString());
  if (result !== store)
    await atomicPrivateWrite(storePath, JSON.stringify(result, null, 2) + "\n", {
      preserveParentMode: true,
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: node memory-client/configure-dream.mjs <CoS bot directory>");
  await configureDream(resolve(process.argv[2]), { release: process.argv[3] === "--release" });
}
