import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { acquireDreamLock, atomicPrivateWrite } from "../dream-files.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test("only one worker owns the data directory and release allows recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-lock-"));
  dirs.push(dir);
  const release = await acquireDreamLock(dir);
  try {
    await expect(acquireDreamLock(dir)).rejects.toThrow("already running");
  } finally {
    release();
  }
  (await acquireDreamLock(dir))();
});

test("publishes private checkpoints durably while the run lock is held", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dream-files-"));
  dirs.push(dir);
  const release = await acquireDreamLock(dir);
  try {
    await atomicPrivateWrite(join(dir, "checkpoint.json"), '{"step":1}');
    await atomicPrivateWrite(join(dir, "checkpoint.json"), '{"step":2}');
    expect(await readFile(join(dir, "checkpoint.json"), "utf8")).toBe('{"step":2}');
    expect((await stat(join(dir, "checkpoint.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  } finally {
    release();
  }
});
