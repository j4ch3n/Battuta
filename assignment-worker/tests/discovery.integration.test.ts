import { expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("prepared worker profile discovers its assignment extension once and preserves private settings", async () => {
  // Match the bundled runtime used by the launcher, not the unbundled SDK loader.
  const runtime = new URL(
    "./bundle/index.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const { DefaultResourceLoader, SettingsManager } = (await import(
    runtime.href
  )) as typeof import("@earendil-works/pi-coding-agent");
  const root = await mkdtemp(join(tmpdir(), "worker-discovery-"));
  try {
    const profile = join(root, "profile");
    const agentDir = join(root, "private");
    await mkdir(join(profile, ".pi/extensions"), { recursive: true });
    await mkdir(agentDir);
    await symlink(
      fileURLToPath(new URL("../index.ts", import.meta.url)),
      join(profile, ".pi/extensions/assignment-worker.ts"),
    );
    await writeFile(join(profile, ".pi/settings.json"), JSON.stringify({ packages: [] }));
    const preferences = JSON.stringify({ theme: "light", defaultModel: "private-model" });
    await writeFile(join(agentDir, "settings.json"), preferences);
    const loader = new DefaultResourceLoader({
      cwd: profile,
      agentDir,
      settingsManager: SettingsManager.create(profile, agentDir),
    });
    for (let i = 0; i < 2; i++) {
      await loader.reload();
      const result = loader.getExtensions();
      expect(result.errors).toEqual([]);
      expect(
        result.extensions.filter((entry) => entry.tools.has("report_execution_result")),
      ).toHaveLength(1);
      expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe(preferences);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
