import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../config.ts";

let root: string;
let input: Record<string, unknown>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "battuta-config-"));
  execFileSync("git", ["init", "-b", "main", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "base",
  ]);
  input = {
    workerId: "worker-1",
    projects: { demo: { checkout: root, baseRef: "HEAD" } },
    worktreeRoot: join(root, "trees"),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function load() {
  const path = join(root, "worker.json");
  await writeFile(path, JSON.stringify(input));
  return loadConfig(path);
}
it("defaults capacity, reconciliation and environment-scoped lock without credentials", async () => {
  const config = await load();
  expect(config.capacity).toBe(1);
  expect(config.reconcileMs).toBe(10000);
  expect(config.lockPath).toMatch(/\.battuta\/worker\/[a-f0-9]+\.lock$/);
  expect(JSON.stringify(config)).not.toContain("password");
});
it.each([
  ["capacity", 0],
  ["capacity", 1.5],
  ["reconcileMs", 999],
  ["reconcileMs", 1000.5],
  ["workerId", "../worker"],
  ["worktreeRoot", "relative"],
  ["lockPath", "relative"],
  ["password", "SUPERSECRET"],
  ["model", { providerID: "x", modelID: "" }],
])("rejects invalid %s without leaking supplied secrets", async (key, value) => {
  input[key] = value;
  await expect(load()).rejects.toThrow("Invalid worker configuration");
});
it.each(["missing", "--help"])("rejects unresolvable base ref %s", async (baseRef) => {
  input.projects = { demo: { checkout: root, baseRef } };
  await expect(load()).rejects.toThrow("Invalid worker configuration");
});
it("rejects a non-checkout", async () => {
  input.projects = { demo: { checkout: tmpdir(), baseRef: "HEAD" } };
  await expect(load()).rejects.toThrow("Invalid worker configuration");
});
it("loads explicit model, lock path and capacity", async () => {
  input.model = { providerID: "test", modelID: "human-model" };
  input.lockPath = join(root, "lock");
  input.capacity = 2;
  input.reconcileMs = 1000;
  const config = await load();
  expect(config.model).toEqual({ providerID: "test", modelID: "human-model" });
  expect(config.lockPath).toBe(join(root, "lock"));
  expect(config.capacity).toBe(2);
});
it("rejects secret fields in project mappings", async () => {
  input.projects = { demo: { checkout: root, baseRef: "HEAD", password: "SUPERSECRET" } };
  await expect(load()).rejects.toThrow("Invalid worker configuration");
});
