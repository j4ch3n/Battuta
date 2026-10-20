import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { createDreamReflection, publishDreamLog } from "../dream-result.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const signal = new AbortController().signal;
const stamp = "2026-10-21T03:00:00.000Z";

test("the model receives actual confirmed changes and produces a one-line reflection", async () => {
  const outcome = {
    changes: [{ before: "Prefers long replies", after: "Prefers concise replies" }],
    failed: [],
  };
  const result = await createDreamReflection(
    (_prompt, evidence) => {
      expect(evidence).toContain("Prefers long replies");
      expect(evidence).toContain("Prefers concise replies");
      return Promise.resolve(
        "I corrected an outdated preference.\nConcise replies now guide the personal profile.",
      );
    },
    stamp,
    outcome,
    signal,
  );
  expect(result).toBe(
    `${stamp} — I corrected an outdated preference. Concise replies now guide the personal profile.`,
  );
});

test.each([147, 148])(
  "enforces the limit including timestamp and separator (%i prose words)",
  async (words) => {
    let attempts = 0;
    const result = createDreamReflection(
      () => {
        attempts++;
        return Promise.resolve(Array(words).fill("word").join(" "));
      },
      stamp,
      {},
      signal,
    );
    if (words === 147) expect((await result).split(/\s+/)).toHaveLength(149);
    else {
      await expect(result).rejects.toThrow("reflection");
      expect(attempts).toBe(2);
    }
  },
);

test.each(["", "```raw entries```", "token ghp_123456789012345678901234567890", "a".repeat(64)])(
  "rejects unsafe or non-narrative output %s",
  async (text) => {
    await expect(
      createDreamReflection(() => Promise.resolve(text), stamp, {}, signal),
    ).rejects.toThrow("reflection");
  },
);

test("publishes a line once per run and preserves prior log entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-log-"));
  dirs.push(dir);
  const line = `${stamp} — I corrected outdated understanding.`;
  await publishDreamLog(dir, stamp, line);
  await publishDreamLog(dir, stamp, line);
  await publishDreamLog(
    dir,
    "2026-10-22T03:00:00.000Z",
    "2026-10-22T03:00:00.000Z — Nothing material changed.",
  );
  expect(await readFile(join(dir, "dream.log"), "utf8")).toBe(
    `${line}\n2026-10-22T03:00:00.000Z — Nothing material changed.\n`,
  );
});
