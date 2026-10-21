import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDreamConfig } from "../dream-config.ts";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))),
);
test.each(["fuzzy", "p/", "/m", "p/model with spaces"])(
  "dream config refuses model %j",
  async (model) => {
    const dir = await mkdtemp(join(tmpdir(), "dream-config-"));
    dirs.push(dir);
    await writeFile(join(dir, "dream-config.json"), JSON.stringify({ version: 1, model }));
    await expect(readDreamConfig(dir)).rejects.toThrow();
  },
);
