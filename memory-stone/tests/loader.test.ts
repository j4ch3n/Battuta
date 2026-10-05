import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { registryFixture } from "./fixtures.ts";

test("Pi's real extension loader can load the bridge and recall from its single utility database", async () => {
  const fixture = await registryFixture();
  const agent = join(fixture.directory, "agent");
  await mkdir(agent);
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("loader-worker.mjs", import.meta.url)),
        join(fixture.directory, "memory.db"),
        agent,
      ],
      { env: { ...process.env, HOME: fixture.directory } },
    );
    expect(result.stdout).toContain("Pi loader smoke passed");
  } finally {
    await fixture.cleanup();
  }
}, 15000);
