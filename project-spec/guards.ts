import { realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { code } from "./store/files.ts";

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (code(error) !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(await canonical(parent), relative(parent, path));
  }
}

export async function managedPath(path: string, cwd: string, root: string) {
  // Match native Pi 1.0.0 path expansion, including clipboard spaces and @ paths.
  let normalized = path.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/^@/, "");
  if (normalized === "~") normalized = homedir();
  else if (normalized.startsWith("~/")) normalized = resolve(homedir(), normalized.slice(2));
  if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
  const target = resolve(cwd, normalized);
  for (const [directory, file] of [
    [resolve(root), target],
    [await canonical(root), await canonical(target)],
  ]) {
    const parts = relative(directory, file).split(/[\\/]/);
    if (parts[0] !== ".." && parts.length >= 2 && parts[1] === "specs") return true;
  }
  return false;
}

export function registerGuards(pi: ExtensionAPI, root: string) {
  pi.on("tool_call", async (event, context) => {
    if (
      ["write", "edit"].includes(event.toolName) &&
      "path" in event.input &&
      typeof event.input.path === "string" &&
      (await managedPath(event.input.path, context.cwd, root))
    ) {
      return {
        block: true,
        reason:
          "Managed specs and metadata must be written through your role's project-spec tools. Direct write/edit is not allowed.",
      };
    }
    return undefined;
  });
}
