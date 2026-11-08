import assert from "node:assert/strict";
import { mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import register from "../index.ts";
import { ProjectSpecStore } from "../store/index.ts";
import { fakePi, fixture } from "./fixtures.ts";

test.each(["missing parent", "missing store", "empty registry", "unknown project"])(
  "spec discovery explains %s without creating project state",
  async (state) => {
    const f = await fixture();
    try {
      const root = f.projects;
      let expected =
        /Project 'Battuta' is not registered.*battuta-project list.*battuta-project init/s;
      if (state === "missing parent") await rm(join(f.root, ".battuta"), { recursive: true });
      if (state === "missing store" || state === "empty registry") {
        await rm(root, { recursive: true });
        if (state === "empty registry") {
          await mkdir(root);
          await mkdir(join(root, ".hidden"));
          await mkdir(join(root, "unregistered"));
          await writeFile(join(root, "notes.txt"), "Not a project");
        }
      }
      if (state.startsWith("missing"))
        expected = /No Battuta project store has been initialized.*battuta-project init/s;
      if (state === "empty registry") expected = /No registered projects.*battuta-project init/s;
      const before = await readdir(f.root, { recursive: true });
      const store = new ProjectSpecStore("cos");
      assert.equal(store.root, f.projects);
      for (const operation of [
        () => store.inspectSpecs("Battuta"),
        () => store.readConstitution("Battuta"),
      ])
        await assert.rejects(operation, expected);
      const fake = fakePi();
      register(fake.pi, { role: "cos" });
      const tool = fake.tools.get("inspect_specs")!;
      await assert.rejects(
        () =>
          tool.execute(
            "test",
            { project: "Battuta" },
            undefined,
            undefined,
            {} as Parameters<typeof tool.execute>[4],
          ),
        expected,
      );
      assert.deepEqual(await readdir(f.root, { recursive: true }), before);
    } finally {
      await f.cleanup();
    }
  },
);

test("discovery preserves invalid-store errors instead of suggesting initialization", async () => {
  const f = await fixture();
  try {
    await rm(f.projects, { recursive: true });
    await writeFile(f.projects, "Not a directory");
    await assert.rejects(f.cos.inspectSpecs("Battuta"), /Expected a directory/);
    assert.equal((await stat(f.projects)).isFile(), true);
  } finally {
    await f.cleanup();
  }
});

test("unknown project messages preserve literal project names", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.cos.inspectSpecs("$&{name}"), /Project '\$&\{name\}' is not registered/);
  } finally {
    await f.cleanup();
  }
});

test.each(["absent", "directory", "symlink", "broken symlink"])(
  "spec registration rejects a %s marker without creating storage",
  async (kind) => {
    const f = await fixture();
    try {
      const marker = join(f.projects, "atlas/project.yaml");
      await rm(marker);
      if (kind === "directory") await mkdir(marker);
      if (kind.includes("symlink"))
        await symlink(
          join(f.projects, kind === "symlink" ? "harbor/project.yaml" : "missing"),
          marker,
        );
      await assert.rejects(f.cos.inspectSpecs("atlas"));
      await assert.rejects(stat(join(f.projects, "atlas/specs")), /ENOENT/);
    } finally {
      await f.cleanup();
    }
  },
);

test.each([".hidden", "Atlas"])(
  "spec discovery rejects non-exact project name %s",
  async (name) => {
    const f = await fixture();
    try {
      if (name === ".hidden") {
        await mkdir(join(f.projects, name));
        await writeFile(join(f.projects, name, "project.yaml"), "version: 1\n");
      }
      await assert.rejects(f.cos.inspectSpecs(name));
    } finally {
      await f.cleanup();
    }
  },
);
