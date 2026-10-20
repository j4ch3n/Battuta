import { spawn } from "node:child_process";
import { once } from "node:events";
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

test.each(["exit", "crash"])(
  "a child process excludes other workers and its %s automatically releases the lock",
  async (termination) => {
    const dir = await mkdtemp(join(tmpdir(), "dream-lock-child-"));
    dirs.push(dir);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          const { acquireDreamLock } = await import(process.argv[2]);
          await acquireDreamLock(process.argv[1]);
          process.on("message", () => process.exit(0));
          process.send("locked");
        `,
        dir,
        new URL("../dream-files.ts", import.meta.url).href,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const exited = once(child, "exit");
    try {
      const readiness = await Promise.race([
        once(child, "message").then(([message]) => message as unknown),
        exited.then(() => {
          throw new Error(`Lock child exited before readiness: ${stderr}`);
        }),
      ]);
      expect(readiness).toBe("locked");
      await expect(acquireDreamLock(dir)).rejects.toThrow("already running");

      if (termination === "crash") child.kill("SIGKILL");
      else child.send("exit");
      expect(await exited).toEqual(termination === "crash" ? [null, "SIGKILL"] : [0, null]);

      // No release callback ran in the child: recovery depends on OS lock cleanup.
      const release = await acquireDreamLock(dir);
      try {
        await atomicPrivateWrite(join(dir, "recovered.json"), '{"recovered":true}');
        expect(await readFile(join(dir, "recovered.json"), "utf8")).toBe('{"recovered":true}');
      } finally {
        release();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  },
);

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
