import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { atomicPrivateWrite, optionalText } from "./dream-files.ts";
import { reconcileDreamSchedule } from "./dream-schedule.ts";
import { schedulerStorePath } from "./scheduler-config.ts";
import { readSchedulerStore } from "./scheduler-store.ts";
import { dreamConfigSchema } from "./dream-config.ts";

// Run only during operator-invoked configuration, with the PM stopped. Never
// edit the scheduler's store concurrently with its in-process read/modify/write.
export async function configureDream(botDirectory) {
  const directory = join(botDirectory, ".pi");
  const settingsPath = join(directory, "settings.json");
  const storePath = schedulerStorePath();
  const dataDirectory = process.env.BATTUTA_MEMORY_DATA_DIR ?? join(homedir(), ".battuta/memory");
  const modelPath = join(dataDirectory, "dream-config.json");
  const settingsText = await optionalText(settingsPath);
  const settings = settingsText ? JSON.parse(settingsText) : {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Invalid PM settings");
  const modelText = await optionalText(modelPath);
  if (!modelText && (!settings.defaultProvider || !settings.defaultModel))
    throw new Error("Configure PM defaultProvider/defaultModel before dream setup");
  const model = dreamConfigSchema.parse(
    modelText
      ? JSON.parse(modelText)
      : { version: 1, model: `${settings.defaultProvider}/${settings.defaultModel}` },
  );
  const store = await readSchedulerStore(storePath);
  const result = reconcileDreamSchedule(store, new Date().toISOString());
  if (
    settings.extensions !== undefined &&
    (!Array.isArray(settings.extensions) || settings.extensions.some((e) => typeof e !== "string"))
  )
    throw new Error("Invalid PM extensions");
  const extension = fileURLToPath(new URL("./dream-extension.ts", import.meta.url));
  settings.extensions = (settings.extensions ?? []).filter(
    (e) => !e.replaceAll("\\", "/").endsWith("/memory-client/dream-extension.ts"),
  );
  settings.extensions.push(extension);
  // Validate first, then make model/extension available before publishing the job.
  await atomicPrivateWrite(modelPath, JSON.stringify(model, null, 2) + "\n");
  await atomicPrivateWrite(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  if (result !== store)
    await atomicPrivateWrite(storePath, JSON.stringify(result, null, 2) + "\n", {
      preserveParentMode: true,
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: node memory-client/configure-dream.mjs <PM bot directory>");
  await configureDream(resolve(process.argv[2]));
}
