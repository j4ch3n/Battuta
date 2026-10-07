import { open, readFile, lstat, mkdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export async function acquireDaemonLock(path: string): Promise<() => Promise<void>> {
  if (!isAbsolute(path)) throw new Error("Lock path must be absolute");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const contents = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    throw new Error(
      "Daemon lock exists or cannot be acquired; operator must inspect ownership and remove a stale lock manually",
    );
  }
  const owned = await handle.stat();
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  let released = false;
  return async () => {
    if (released) return;
    const current = await lstat(path);
    if (
      current.isSymbolicLink() ||
      current.dev !== owned.dev ||
      current.ino !== owned.ino ||
      (await readFile(path, "utf8")) !== contents
    )
      throw new Error("Daemon lock ownership changed; operator inspection required");
    // Exclusive daemon ownership is an operator contract; do not auto-recover stale locks.
    await unlink(path);
    released = true;
  };
}
