import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("Pi loader registers only lifecycle capture and read-only PM profile loading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-loader-test-"));
  try {
    const result = await promisify(execFile)(process.execPath, [
      "tests/loader-worker.mjs",
      directory,
      "../bots/pm-bot/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    ]);
    expect(result.stdout).toContain("read-only profile smoke passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
