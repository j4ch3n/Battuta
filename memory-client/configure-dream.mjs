import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicPrivateWrite, optionalText } from "./dream-files.ts";
import { reconcileDreamSchedule } from "./dream-schedule.ts";

// Run only during operator-invoked configuration, with the PM stopped. Never
// edit the scheduler's store concurrently with its in-process read/modify/write.
export async function configureDream(botDirectory) {
  const directory = join(botDirectory, ".pi");
  const settingsPath = join(directory, "settings.json");
  const storePath = join(directory, "schedule-prompts.json");
  const settingsText = await optionalText(settingsPath);
  const storeText = await optionalText(storePath);
  const result = reconcileDreamSchedule(
    storeText ? JSON.parse(storeText) : { version: 1, jobs: [] },
    settingsText ? JSON.parse(settingsText) : {},
    fileURLToPath(new URL("./dream-extension.ts", import.meta.url)),
    new Date().toISOString(),
  );
  // Make the extension discoverable before publishing its scheduled job.
  await atomicPrivateWrite(settingsPath, JSON.stringify(result.settings, null, 2) + "\n");
  await atomicPrivateWrite(storePath, JSON.stringify(result.store, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: node memory-client/configure-dream.mjs <PM bot directory>");
  await configureDream(resolve(process.argv[2]));
}
