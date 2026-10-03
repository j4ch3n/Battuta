import { createHash, randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function directory(path: string, optional = false) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Directory must not be a symlink: ${path}`);
    if (!info.isDirectory()) throw new Error(`Expected a directory: ${path}`);
    return true;
  } catch (error) {
    if (optional && code(error) === "ENOENT") return false;
    throw error;
  }
}

export function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

export async function readOptional(path: string): Promise<Buffer | null> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`File must not be a symlink: ${path}`);
    if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
    const handle = await open(path, "r");
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (code(error) === "ENOENT") return null;
    throw error;
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function syncDirectory(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWrite(path: string, bytes: string | Buffer, mode = 0o600) {
  await readOptional(path); // Reject symlinks/non-files even when rename would replace them.
  const temporary = join(dirname(path), `.project-spec-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", mode);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await readOptional(path);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function setMode(path: string, mode: number) {
  await readOptional(path);
  const handle = await open(path, "r");
  try {
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function nonblank(value: string, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must not be blank`);
}
