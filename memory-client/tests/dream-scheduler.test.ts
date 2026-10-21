import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("native scheduler delivery and startup catch-up share a private deduplicated dream", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dream-scheduler-"));
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ["tests/dream-scheduler-worker.mjs", directory],
      {
        timeout: 25000,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          PI_CODING_AGENT_DIR: join(directory, ".pi"),
          AGENT_ROLE: "pm",
          TZ: "America/New_York",
        },
      },
    );
    expect(result.stdout).toContain("Pinned scheduler dream isolation passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
