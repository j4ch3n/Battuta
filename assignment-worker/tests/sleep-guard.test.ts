import { expect, test } from "vitest";
import { isLongSleep } from "../sleep-guard.ts";

test.each([
  "sleep 600",
  "sleep 61",
  "sleep 2m",
  "sleep 0.5h",
  "sleep 30 31",
  "sleep infinity",
  "sleep $DELAY",
  "cd /work && sleep 900",
  "while true; do sleep 120; done",
  "git status; sleep 90 && git status",
])("%s is a long sleep", (command) => {
  expect(isLongSleep(command)).toBe(true);
});

test.each([
  "sleep 60",
  "sleep 1m",
  "sleep 30 30",
  "sleep .5",
  "for i in 1 2 3; do sleep 45; done",
  "git status",
  "echo nosleep 600",
  "grep -r sleep src",
])("%s is not a long sleep", (command) => {
  expect(isLongSleep(command)).toBe(false);
});
