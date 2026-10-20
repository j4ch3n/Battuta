import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { recordDreamUsage } from "../dream-usage.ts";

test("usage log retains previous calls and drops all provider text metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-usage-"));
  try {
    await recordDreamUsage(dir, {
      input: 1,
      totalTokens: 3,
      prompt: "secret evidence",
      cost: { total: 0.01, text: "private" },
    });
    await recordDreamUsage(dir, { input: 2, output: 4 });
    const text = await readFile(join(dir, "dream-usage.jsonl"), "utf8");
    expect(text).not.toMatch(/secret|private|prompt/);
    const lines: unknown[] = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([
      {
        timestamp: expect.any(String) as unknown,
        usage: { input: 1, totalTokens: 3, cost: { total: 0.01 } },
      },
      { timestamp: expect.any(String) as unknown, usage: { input: 2, output: 4 } },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
