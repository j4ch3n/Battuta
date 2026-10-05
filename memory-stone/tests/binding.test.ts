import { afterEach, expect, test } from "vitest";
import { writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { resolveBinding } from "../binding.ts";
import { registryFixture } from "./fixtures.ts";

const fixtures: Awaited<ReturnType<typeof registryFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});
async function setup() {
  const fixture = await registryFixture();
  fixtures.push(fixture);
  return fixture;
}

test("binds to the selected registered Git root independently of the bot cwd", async () => {
  const fixture = await setup();
  expect(await resolveBinding(fixture.root)).toEqual({
    name: "atlas",
    checkout: await realpath(fixture.projects.atlas),
    projectId: await realpath(fixture.projects.atlas),
  });
  await fixture.select("harbor");
  expect((await resolveBinding(fixture.root)).name).toBe("harbor");
});

test.each([null, "../atlas", "missing", "", ".config.json"])(
  "rejects invalid selection %s without creating fallback memory",
  async (name) => {
    const fixture = await setup();
    await fixture.select(name);
    await expect(resolveBinding(fixture.root)).rejects.toThrow();
  },
);

test.each(["name", "path", "version"])("rejects mismatched registration %s", async (field) => {
  const fixture = await setup();
  const config = {
    version: field === "version" ? 2 : 1,
    project: {
      name: field === "name" ? "harbor" : "atlas",
      path: field === "path" ? fixture.projects.harbor : fixture.projects.atlas,
    },
  };
  await writeFile(join(fixture.root, "atlas/project.yaml"), JSON.stringify(config));
  await expect(resolveBinding(fixture.root)).rejects.toThrow();
});

test.each([".config.json", "atlas/project.yaml", "atlas/code"])(
  "rejects symlinked registration component %s",
  async (relative) => {
    const fixture = await setup();
    const path = join(fixture.root, relative);
    await rm(path, { recursive: true });
    await symlink(
      relative === "atlas/code"
        ? fixture.projects.harbor
        : join(fixture.root, "harbor/project.yaml"),
      path,
    );
    await expect(resolveBinding(fixture.root)).rejects.toThrow();
  },
);
