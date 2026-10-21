import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("published scheduler persists and delivers global prompts across workspace/session changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scheduler-contract-"));
  try {
    const options = {
      timeout: 20000,
      env: { PATH: process.env.PATH, HOME: directory, TZ: "America/New_York" },
    };
    await promisify(execFile)(
      process.execPath,
      ["tests/scheduler-contract-worker.mjs", directory, "seed"],
      options,
    );
    const result = await promisify(execFile)(
      process.execPath,
      ["tests/scheduler-contract-worker.mjs", directory, "resume"],
      options,
    );
    expect(result.stdout).toContain("Upstream scheduler contract passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
