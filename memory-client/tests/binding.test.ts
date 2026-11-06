import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveRequestBinding } from "../binding.ts";
test("binding uses registered slug rather than checkout path, rejecting symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "binding-test-"));
  try {
    const binding = {
      request_id: "r1",
      conversation_id: "c1",
      session_id: "s1",
      project: null,
      origin: "owner",
      admitted_at: "2026-11-06T10:00:00Z",
    };
    expect((await resolveRequestBinding(binding, root)).project).toBeNull();
    await expect(resolveRequestBinding(undefined, root)).rejects.toThrow();
    await mkdir(join(root, "atlas/code"), { recursive: true });
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "atlas" }));
    await writeFile(
      join(root, "atlas/project.yaml"),
      `version: 1\nproject:\n  name: atlas\n  path: ${root}/atlas/code\n`,
    );
    expect((await resolveRequestBinding({ ...binding, project: "atlas" }, root)).project).toBe(
      "atlas",
    );
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "unrelated" }));
    expect((await resolveRequestBinding({ ...binding, project: "atlas" }, root)).project).toBe(
      "atlas",
    );
    await symlink(join(root, "atlas"), join(root, "alias"));
    await writeFile(join(root, ".config.json"), JSON.stringify({ currentProject: "alias" }));
    await expect(resolveRequestBinding({ ...binding, project: "alias" }, root)).rejects.toThrow();
    await expect(
      resolveRequestBinding({ ...binding, admitted_at: "2026-11-06T10:00:00" }, root),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
