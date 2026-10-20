import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { captureSettings, clientConfig } from "../config.ts";

afterEach(() => vi.unstubAllEnvs());

test.each(["pm", "tl"])("%s capture queue defaults to shared memory directory", (role) => {
  vi.stubEnv("AGENT_ROLE", role);
  vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", undefined);
  expect(clientConfig().queue).toBe(join(homedir(), ".battuta/memory/capture-queue", role));
});

test("capture queue respects an explicit data directory", () => {
  vi.stubEnv("AGENT_ROLE", "pm");
  vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", "/custom/memory");
  expect(clientConfig().queue).toBe("/custom/memory/capture-queue/pm");
  expect(clientConfig().dataDirectory).toBe("/custom/memory");
});
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
