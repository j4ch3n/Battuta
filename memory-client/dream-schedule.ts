import { z } from "zod";

export const DREAM_JOB_ID = "battuta-memory-dream";
const JOB_NAME = "nightly-memory-dream";
const storeSchema = z
  .object({ version: z.literal(1), jobs: z.array(z.record(z.string(), z.unknown())) })
  .passthrough();
const settingsSchema = z
  .object({
    defaultProvider: z.string().min(1).optional(),
    defaultModel: z.string().min(1).optional(),
    extensions: z.array(z.string()).optional(),
  })
  .passthrough();

export function reconcileDreamSchedule(
  input: unknown,
  inputSettings: unknown,
  extensionPath: string,
  timestamp: string,
) {
  const store = storeSchema.parse(input);
  const settings = settingsSchema.parse(inputSettings);
  const matching = store.jobs.filter((job) => job.id === DREAM_JOB_ID || job.name === JOB_NAME);
  if (matching.length > 1 || matching.some((job) => job.id !== DREAM_JOB_ID))
    throw new Error("Dream job ownership conflict");
  const previous = matching[0];
  const model =
    typeof previous?.model === "string" && previous.model.trim()
      ? previous.model
      : settings.defaultProvider && settings.defaultModel
        ? `${settings.defaultProvider}/${settings.defaultModel}`
        : undefined;
  if (!model) throw new Error("Configure PM defaultProvider/defaultModel before dream setup");
  if (!/^[^/\s]+\/[^\s]+$/.test(model))
    throw new Error(
      "Dream requires an explicit provider/model; fix the owned job while PM is stopped",
    );
  const job: Record<string, unknown> = {
    createdAt: timestamp,
    runCount: 0,
    ...previous,
    id: DREAM_JOB_ID,
    name: JOB_NAME,
    type: "cron",
    schedule: "0 0 3 * * *",
    prompt:
      "Call memory_dream exactly once, then repeat its returned reflection unchanged. Do not mutate memories or files yourself. If the tool fails, report failure concisely without claiming completion.",
    enabled: previous?.enabled !== false,
    model,
    notify: false,
    extensions: [extensionPath],
    skills: [],
  };
  delete job.session;
  const jobs = previous
    ? store.jobs.map((existing) => (existing.id === DREAM_JOB_ID ? job : existing))
    : [...store.jobs, job];
  const extensions = (settings.extensions ?? []).filter(
    (path) => !path.replaceAll("\\", "/").endsWith("/memory-client/dream-extension.ts"),
  );
  if (!extensions.includes(extensionPath)) extensions.push(extensionPath);
  return { store: { ...store, jobs }, settings: { ...settings, extensions } };
}
