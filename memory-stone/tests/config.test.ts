import { expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "../config.ts";
import { registryFixture } from "./fixtures.ts";

test("uses bot-local configuration without consulting the selected checkout", async () => {
  const fixture = await registryFixture();
  try {
    const agent = join(fixture.directory, "agent");
    await mkdir(agent);
    expect((await readConfig(agent)).includeGlobal).toBe(true);
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({ battutaMemory: { enabled: false, maxRecords: 3, includeGlobal: false } }),
    );
    expect(await readConfig(agent)).toMatchObject({
      enabled: false,
      maxRecords: 3,
      includeGlobal: false,
    });
    for (const value of [
      null,
      [],
      { maxRecords: 0 },
      { maxTokens: 1 },
      { threshold: -1 },
      { enabled: "true" },
    ]) {
      await writeFile(join(agent, "settings.json"), JSON.stringify({ battutaMemory: value }));
      await expect(readConfig(agent)).rejects.toThrow();
    }
  } finally {
    await fixture.cleanup();
  }
});
