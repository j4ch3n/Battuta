import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDaemonLock } from "../lock.ts";

let root: string;
let path: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "battuta-lock-"));
  path = join(root, "daemon.lock");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("allows exactly one concurrent owner and releases its unchanged lock", async () => {
  const results = await Promise.allSettled([acquireDaemonLock(path), acquireDaemonLock(path)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  expect(Object.keys(data).sort()).toEqual(["nonce", "pid"]);
  for (const result of results) if (result.status === "fulfilled") await result.value();
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("refuses stale locks with operator guidance and preserves them", async () => {
  await writeFile(path, "stale");
  await expect(acquireDaemonLock(path)).rejects.toThrow(/operator/i);
  expect(await readFile(path, "utf8")).toBe("stale");
});
it("never releases a lock replaced by another owner", async () => {
  const release = await acquireDaemonLock(path);
  await rm(path);
  await writeFile(path, "other owner");
  await expect(release()).rejects.toThrow(/ownership/);
  expect(await readFile(path, "utf8")).toBe("other owner");
});
it("never releases modified lock contents", async () => {
  const release = await acquireDaemonLock(path);
  await writeFile(path, "changed");
  await expect(release()).rejects.toThrow(/ownership/);
  expect(await readFile(path, "utf8")).toBe("changed");
});
it("rejects relative lock paths", async () => {
  await expect(acquireDaemonLock("relative.lock")).rejects.toThrow(/absolute/);
});
it("release is idempotent and cannot affect a later owner", async () => {
  const release = await acquireDaemonLock(path);
  await release();
  const later = await acquireDaemonLock(path);
  await release();
  expect(await readFile(path, "utf8")).toContain("nonce");
  await later();
});
