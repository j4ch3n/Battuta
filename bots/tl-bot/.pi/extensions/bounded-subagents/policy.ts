import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export type Profile = "scout" | "worker" | "reviewer";
export interface Config {
  root: string;
  inputs: string[];
  writable: string[];
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  concurrency: number;
  maxSpawns: number;
  timeoutMs: number;
}
const KEYS = ["OPENAI_API_KEY", "BATTUTA_CHILD_API_KEY"];
export function safeRelative(path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path
      .split("/")
      .some((p) => !p || p.startsWith(".") || /^(auth|credentials|settings|mcp)\.json$/i.test(p))
  )
    throw new Error(`Private or invalid path: ${path}`);
  return path;
}
export function scopedPath(root: string, path: string, allowed: string[]): string {
  safeRelative(path);
  if (!allowed.includes(path)) throw new Error(`Path not granted: ${path}`);
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symlink paths are forbidden");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}
export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Subagents require an operator grant");
  const v = value as Record<string, unknown>;
  const keys = [
    "root",
    "inputs",
    "writable",
    "model",
    "baseUrl",
    "apiKeyEnv",
    "concurrency",
    "maxSpawns",
    "timeoutMs",
  ];
  if (Object.keys(v).some((key) => !keys.includes(key)))
    throw new Error("Unknown subagent setting");
  function text(key: string): string {
    if (typeof v[key] !== "string" || !v[key].trim()) throw new Error(`Missing ${key}`);
    return v[key];
  }
  function paths(key: string): string[] {
    const list = v[key] ?? [];
    if (
      !Array.isArray(list) ||
      list.length > 64 ||
      list.some((p: unknown) => typeof p !== "string")
    )
      throw new Error(`Invalid ${key}`);
    return [...new Set((list as string[]).map(safeRelative))];
  }
  function limit(key: string, fallback: number, max: number): number {
    const n = v[key] ?? fallback;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max)
      throw new Error(`Invalid ${key}`);
    return n;
  }
  const root = text("root");
  if (!isAbsolute(root) || !statSync(root).isDirectory())
    throw new Error("root must be an absolute directory");
  const url = new URL(text("baseUrl"));
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid child provider URL");
  const apiKeyEnv = text("apiKeyEnv");
  if (!KEYS.includes(apiKeyEnv))
    throw new Error("Child credential must be a dedicated provider key");
  return {
    root: realpathSync(root),
    inputs: paths("inputs"),
    writable: paths("writable"),
    model: text("model"),
    baseUrl: url.toString().replace(/\/$/, ""),
    apiKeyEnv,
    concurrency: limit("concurrency", 2, 4),
    maxSpawns: limit("maxSpawns", 12, 32),
    timeoutMs: limit("timeoutMs", 120000, 600000),
  };
}
export function prepareWorkspace(config: Config, _profile: Profile): string {
  const root = mkdtempSync(join(tmpdir(), "battuta-child-"));
  try {
    let total = 0;
    for (const path of config.inputs) {
      const source = scopedPath(config.root, path, config.inputs);
      const info = statSync(source);
      total += info.size;
      if (!info.isFile() || info.size > 262144 || total > 2097152)
        throw new Error("Input size limit exceeded");
      const target = join(root, "work", path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(source, target);
    }
    mkdirSync(join(root, "work"), { recursive: true, mode: 0o700 });
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
