import { execFile } from "node:child_process";
import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { registryFixture } from "./fixtures.ts";

test("the bridge loads with only locked production dependencies in a relocated release", async () => {
  const fixture = await registryFixture();
  const source = fileURLToPath(new URL("..", import.meta.url));
  const stage = join(fixture.directory, "release/memory-stone");
  const agent = join(fixture.directory, "agent");
  const exec = promisify(execFile);
  try {
    await mkdir(stage, { recursive: true });
    await mkdir(agent);
    await cp(join(source, "../shared-skills/memory"), join(stage, "../shared-skills/memory"), {
      recursive: true,
    });
    for (const file of await readdir(source)) {
      if (
        file.endsWith(".ts") ||
        ["package.json", "pnpm-lock.yaml", "tools", "commands", "profile", "tests"].includes(file)
      )
        await cp(join(source, file), join(stage, file), { recursive: true });
    }
    await exec(
      "pnpm",
      ["install", "--offline", "--frozen-lockfile", "--prod", "--ignore-scripts"],
      { cwd: stage },
    );
    const loaded = await exec(
      process.execPath,
      [
        join(stage, "tests/loader-worker.mjs"),
        join(fixture.directory, "memory.db"),
        agent,
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
      ],
      { env: { ...process.env, HOME: fixture.directory } },
    );
    expect(loaded.stdout).toContain("Pi loader smoke passed");
  } finally {
    await fixture.cleanup();
  }
}, 30000);
