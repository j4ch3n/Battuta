import type { SchedulerStore } from "./scheduler-store.ts";

export const DREAM_JOB_ID = "battuta-memory-dream";
export const DREAM_JOB_NAME = "nightly-memory-dream";
export const DREAM_PROMPT =
  "Call memory_dream exactly once. On success, report that it ran successfully and include its public summary. Otherwise report its actual status honestly, without inventing a summary. Do not request or repeat private dream reflections.";
const LEGACY_DREAM_PROMPT =
  "Call memory_dream exactly once. Report only its completion status. Do not request or repeat private dream reflections.";

export function ownedDreamTask(task: SchedulerStore["tasks"][number]): boolean {
  return (
    task.id === DREAM_JOB_ID &&
    task.name === DREAM_JOB_NAME &&
    task.action === "prompt" &&
    task.type === "cron" &&
    task.schedule === "0 0 3 * * *" &&
    task.scope === "global" &&
    (task.prompt === DREAM_PROMPT || task.prompt === LEGACY_DREAM_PROMPT) &&
    task.cwd === undefined &&
    task.sessionFile === undefined &&
    task.expiresAt === undefined &&
    task.maxRuns === undefined
  );
}

export function reconcileDreamSchedule(store: SchedulerStore, now: string): SchedulerStore {
  const matching = store.tasks.filter(
    (task) => task.id === DREAM_JOB_ID || task.name === DREAM_JOB_NAME,
  );
  if (matching.length > 1 || matching.some((task) => !ownedDreamTask(task)))
    throw new Error("Dream job ownership conflict");
  if (matching.length) {
    if (matching[0].prompt === DREAM_PROMPT) return store;
    // Setup runs with PM stopped: upgrade only our exact previous instruction,
    // preserving owner disablement and native scheduler history.
    return {
      ...store,
      revision: store.revision + 1,
      tasks: store.tasks.map((task) =>
        task === matching[0] ? { ...task, prompt: DREAM_PROMPT } : task,
      ),
    };
  }
  return {
    ...store,
    revision: store.revision + 1,
    tasks: [
      ...store.tasks,
      {
        id: DREAM_JOB_ID,
        name: DREAM_JOB_NAME,
        action: "prompt",
        type: "cron",
        schedule: "0 0 3 * * *",
        scope: "global",
        status: "pending",
        enabled: true,
        prompt: DREAM_PROMPT,
        createdAt: now,
        runCount: 0,
      },
    ],
  };
}
