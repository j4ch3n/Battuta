import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import { createDreamReflection, publishDreamLog } from "../dream-result.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

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

test.each(["", "```raw entries```", "a".repeat(64)])(
  "rejects unsafe or non-narrative output %s",
  async (text) => {
    await expect(
      createDreamReflection(() => Promise.resolve(text), stamp, {}, signal),
    ).rejects.toThrow("reflection");
  },
);

test("accepts credential-like model output for a local reflection", async () => {
  const text = "token ghp_123456789012345678901234567890";

  await expect(createDreamReflection(() => Promise.resolve(text), stamp, {}, signal)).resolves.toBe(
    `${stamp} — ${text}`,
  );
});

test.each(["", "```raw entries```", Array(148).fill("word").join(" ")])(
  "retries invalid output once and returns a valid bounded second reflection (%s)",
  async (invalid) => {
    const prompts: string[] = [];
    const evidenceSeen: string[] = [];
    const valid = Array(147).fill("changed").join(" ");
    const result = await createDreamReflection(
      (prompt, evidence, receivedSignal) => {
        prompts.push(prompt);
        evidenceSeen.push(evidence);
        expect(receivedSignal).toBe(signal);
        return Promise.resolve(prompts.length === 1 ? invalid : valid);
      },
      stamp,
      { changed: true },
      signal,
    );
    expect(result).toBe(`${stamp} — ${valid}`);
    expect(result.split(/\s+/)).toHaveLength(149);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Previous output was invalid");
    expect(evidenceSeen).toEqual(['{"changed":true}', '{"changed":true}']);
  },
);

test.each([200000, 200001])(
  "enforces the evidence byte budget before calling the model (%i bytes)",
  async (bytes) => {
    let calls = 0;
    // The JSON envelope is eleven bytes; multibyte text catches character-count budgets.
    const note = "é".repeat(99994) + "x".repeat(bytes - 199999);
    const result = createDreamReflection(
      () => {
        calls++;
        return Promise.resolve("Nothing material changed.");
      },
      stamp,
      { note },
      signal,
    );
    if (bytes === 200000) {
      await expect(result).resolves.toBe(`${stamp} — Nothing material changed.`);
      expect(calls).toBe(1);
    } else {
      await expect(result).rejects.toThrow("evidence exceeds budget");
      expect(calls).toBe(0);
    }
  },
);

test("an already aborted reflection never calls the model", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled before reflection");
  controller.abort(reason);
  let calls = 0;
  await expect(
    createDreamReflection(
      () => {
        calls++;
        return Promise.resolve("Nothing material changed.");
      },
      stamp,
      {},
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(calls).toBe(0);
});

test("cancellation after invalid output prevents the retry", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled during reflection");
  let calls = 0;
  await expect(
    createDreamReflection(
      () => {
        calls++;
        controller.abort(reason);
        return Promise.resolve("");
      },
      stamp,
      {},
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(calls).toBe(1);
});

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

test("a conflicting reflection for an existing run leaves the original log unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-log-conflict-"));
  dirs.push(dir);
  const original = `earlier — An earlier reflection.\n${stamp} — Nothing material changed.\n`;
  await writeFile(join(dir, "dream.log"), original);

  await expect(publishDreamLog(dir, stamp, `${stamp} — A different reflection.`)).rejects.toThrow(
    "run conflict",
  );

  expect(await readFile(join(dir, "dream.log"), "utf8")).toBe(original);
  expect(await readdir(dir)).toEqual(["dream.log"]);
});

test("failed publication preserves the old log, cleans temporary files, and retries exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-log-retry-"));
  dirs.push(dir);
  const original = "earlier — An earlier reflection.";
  const path = join(dir, "dream.log");
  const line = `${stamp} — Nothing material changed.`;
  await writeFile(path, original);
  const failure = new Error("injected rename failure");
  vi.mocked(rename).mockRejectedValueOnce(failure);

  await expect(publishDreamLog(dir, stamp, line)).rejects.toBe(failure);
  expect(await readFile(path, "utf8")).toBe(original);
  expect(await readdir(dir)).toEqual(["dream.log"]);

  await publishDreamLog(dir, stamp, line);
  await publishDreamLog(dir, stamp, line);
  expect(await readFile(path, "utf8")).toBe(`${original}\n${line}\n`);
  expect(await readdir(dir)).toEqual(["dream.log"]);
});
