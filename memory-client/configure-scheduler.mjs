import { schedulerStorePath, schedulerCatchUpMax } from "./scheduler-config.ts";
import { initializeSchedulerStore, readSchedulerStore } from "./scheduler-store.ts";

try {
  const path = schedulerStorePath();
  const catchUp = schedulerCatchUpMax();
  switch (process.argv[2]) {
    case "--print-path":
      console.log(path);
      break;
    case "--print-catchup":
      console.log(catchUp);
      break;
    case "--initialize":
      await initializeSchedulerStore(path);
      break;
    case "--check":
      await readSchedulerStore(path);
      break;
    default:
      throw new Error(
        "Usage: configure-scheduler.mjs --initialize|--check|--print-path|--print-catchup",
      );
  }
} catch (error) {
  console.error(`Scheduler configuration failed: ${error.message}`);
  process.exitCode = 1;
}
