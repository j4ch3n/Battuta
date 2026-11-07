import { open } from "node:fs/promises";
import { join } from "node:path";

export async function readOwnerProfile(directory: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(join(directory, "ME.md"), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    if ((await handle.stat()).size > 32000) throw new Error("Owner profile exceeds size limit");
    const content = await handle.readFile("utf8");
    if (Buffer.byteLength(content) > 32000) throw new Error("Owner profile exceeds size limit");
    return content;
  } finally {
    await handle.close();
  }
}
