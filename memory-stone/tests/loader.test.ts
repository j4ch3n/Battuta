import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { registryFixture } from "./fixtures.ts";

test.each(["default", "symlinked host"])(
  "Pi's real extension loader can load the bridge and recall using a %s entry",
  async (mode) => {
    const fixture = await registryFixture();
    const agent = join(fixture.directory, "agent");
    await mkdir(agent);
    try {
      const hostArguments: string[] = [];
      if (mode === "symlinked host") {
        const host = join(fixture.directory, "host-pi");
        await symlink(
          fileURLToPath(new URL("../", import.meta.resolve("@earendil-works/pi-coding-agent"))),
          host,
          "dir",
        );
        hostArguments.push(join(host, "dist", "index.js"));
      }
      const result = await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL("loader-worker.mjs", import.meta.url)),
          join(fixture.directory, "memory.db"),
          agent,
          ...hostArguments,
        ],
        { env: { ...process.env, HOME: fixture.directory } },
      );
      expect(result.stdout).toContain("Pi loader smoke passed");
    } finally {
      await fixture.cleanup();
    }
  },
  15000,
);
