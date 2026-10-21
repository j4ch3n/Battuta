import { expect, test } from "vitest";
import { schedulerStorePath, schedulerCatchUpMax } from "../scheduler-config.ts";

test("scheduler storage is independent of cwd and Pi state", () => {
  expect(schedulerStorePath({ PI_CODING_AGENT_DIR: "/release/.pi" }, "/owner")).toBe(
    "/owner/.battuta/schedule-prompts.json",
  );
  expect(schedulerStorePath({ PI_SCHEDULER_STATE_FILE: "/private dir/jobs.json" })).toBe(
    "/private dir/jobs.json",
  );
});
test.each(["", " ", "relative.json", "~/jobs.json"])("rejects configured path %j", (path) => {
  expect(() => schedulerStorePath({ PI_SCHEDULER_STATE_FILE: path })).toThrow("absolute");
});
test("cron replay defaults off but accepts an explicit nonnegative integer", () => {
  expect(schedulerCatchUpMax({})).toBe("0");
  expect(schedulerCatchUpMax({ PI_SCHEDULER_CATCHUP_MAX: "5" })).toBe("5");
});
test.each(["", "-1", "1.5", "oops"])("rejects catch-up limit %j", (value) => {
  expect(() => schedulerCatchUpMax({ PI_SCHEDULER_CATCHUP_MAX: value })).toThrow();
});
