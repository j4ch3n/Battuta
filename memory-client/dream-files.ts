import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicPrivateWrite(path: string, content: string) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = join(directory, `.dream-${randomUUID()}`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

// Empty database used only for SQLite's OS-released cross-process lock. Private
// run checkpoints use separate files, so each acknowledged step survives a crash.
export async function acquireDreamLock(directory: string): Promise<() => void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, "dream-lock.db");
  const file = await open(path, "a", 0o600);
  await file.close();
  await chmod(path, 0o600);
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch {
    database.close();
    throw new Error("Dream already running");
  }
  return () => database.close();
}
