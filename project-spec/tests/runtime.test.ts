import assert from "node:assert/strict";
import { cp, mkdir, realpath, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { fixture } from "./fixtures.ts";

test("Pi loads a staged extension with only production dependencies for both roles", async () => {
  const f = await fixture();
  const previous = process.env.AGENT_ROLE;
  const packageRoot = resolve(import.meta.dirname, "..");
  try {
    const staged = join(f.root, "release/project-spec");
    await mkdir(join(staged, "node_modules"), { recursive: true });
    for (const item of ["index.ts", "guards.ts", "store", "tools", "package.json"])
      await cp(join(packageRoot, item), join(staged, item), { recursive: true });
    for (const dependency of ["typebox", "yaml", "proper-lockfile"])
      await symlink(
        await realpath(join(packageRoot, "node_modules", dependency)),
        join(staged, "node_modules", dependency),
        "dir",
      );
    for (const role of ["pm", "tl"]) {
      process.env.AGENT_ROLE = role;
      const agentDir = join(f.root, role);
      await mkdir(agentDir);
      const loader = new DefaultResourceLoader({
        cwd: agentDir,
        agentDir,
        additionalExtensionPaths: [join(staged, "index.ts")],
        noContextFiles: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await loader.reload({ resolveProjectTrust: () => Promise.resolve(true) });
      const loaded = loader.getExtensions();
      assert.deepEqual(loaded.errors, []);
      const extension = loaded.extensions.find((e) => e.resolvedPath === join(staged, "index.ts"));
      assert.ok(extension, "Shared extension must load through Pi's real loader");
      assert.ok(extension.tools.has("describe_spec"));
      assert.equal(extension.tools.has("finalize_spec"), role === "pm");
      assert.equal(extension.tools.has("write_spec_review"), role === "tl");
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_ROLE;
    else process.env.AGENT_ROLE = previous;
    await f.cleanup();
  }
});
