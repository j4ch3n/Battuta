import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("provisioned dream prompt survives process and release-directory changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scheduler-wiring-"));
  try {
    const options = {
      timeout: 20000,
      env: { PATH: process.env.PATH, HOME: directory, TZ: "America/New_York" },
    };
    await promisify(execFile)(
      process.execPath,
      ["tests/scheduler-wiring-worker.mjs", directory, "seed"],
      options,
    );
    const result = await promisify(execFile)(
      process.execPath,
      ["tests/scheduler-wiring-worker.mjs", directory, "resume"],
      options,
    );
    expect(result.stdout).toContain("Stable dream scheduler wiring passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
