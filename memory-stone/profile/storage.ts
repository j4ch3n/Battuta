import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, open } from "node:fs/promises";
import { join } from "node:path";

export const profileTitle = "# About Human Product Owner";
export const maxProfileBytes = 32_000;

export class OwnerProfile {
  readonly path: string;
  constructor(readonly directory: string) {
    this.path = join(directory, "ME.md");
  }

  async read() {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { path: this.path, exists: false, content: "", revision: "missing" };
    }
    if (Buffer.byteLength(content) > maxProfileBytes)
      throw new Error("Owner profile exceeds size limit");
    return {
      path: this.path,
      exists: true,
      content,
      revision: createHash("sha256").update(content).digest("hex"),
    };
  }

  async write(content: string, expectedRevision: string, signal?: AbortSignal) {
    if (
      !content.startsWith(`${profileTitle}\n`) ||
      !/^## .+/m.test(content) ||
      content.includes("```") ||
      Buffer.byteLength(content) > maxProfileBytes
    )
      throw new Error("Invalid owner profile Markdown");
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    // Fail closed on abandoned locks; never steal a lock while another process may write.
    const lock = await open(lockPath, "wx", 0o600).catch(() => {
      throw new Error(
        "Owner profile is locked; retry after the writer finishes (inspect abandoned locks manually)",
      );
    });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      if ((await this.read()).revision !== expectedRevision)
        throw new Error("Owner profile revision changed; read again before retrying");
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(content);
        await file.sync();
      } finally {
        await file.close();
      }
      signal?.throwIfAborted();
      if ((await this.read()).revision !== expectedRevision)
        throw new Error("Owner profile revision changed before commit");
      await rename(temporary, this.path);
      return await this.read();
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await lock.close();
      await unlink(lockPath);
    }
  }
}
