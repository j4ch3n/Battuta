import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { captureSettings } from "../config.ts";
test("capture configuration validates new defaults and explicit disable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-config-test-"));
  try {
    expect(await captureSettings(dir)).toEqual({ enabled: true, batchMessages: 6 });
    await writeFile(
      join(dir, "settings.json"),
      '{"battutaMemoryCapture":{"enabled":false,"batchMessages":4}}',
    );
    expect(await captureSettings(dir)).toEqual({ enabled: false, batchMessages: 4 });
    await writeFile(join(dir, "settings.json"), '{"battutaMemoryCapture":{"batchMessages":0}}');
    await expect(captureSettings(dir)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
