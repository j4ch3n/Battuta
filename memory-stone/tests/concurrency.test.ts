import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registryFixture } from "./fixtures.ts";
import { MemoryStore } from "../store.ts";
import { resolveBinding } from "../binding.ts";

const exec = promisify(execFile);
test("two bots initialize and write the same database concurrently without corrupting FTS", async () => {
  const fixture = await registryFixture();
  const path = join(fixture.directory, "shared/memory.db");
  const worker = fileURLToPath(new URL("process-worker.ts", import.meta.url));
  let store: MemoryStore | undefined;
  try {
    const atlas = await resolveBinding(fixture.root);
    await Promise.all(
      ["Manager", "Lead"].map((role) =>
        exec(process.execPath, [worker, path, atlas.projectId, `${role} decision PostgreSQL`]),
      ),
    );
    store = await MemoryStore.open(path);
    expect(store.list(atlas, "project")).toHaveLength(25);
    expect(store.search(atlas, "PostgreSQL", "project", 20)).toHaveLength(20);
    const another = await exec(process.execPath, [worker, path, atlas.projectId]);
    expect(JSON.parse(another.stdout)).toHaveLength(25);
    // The worker has shut down its own connection; this connection remains usable.
    expect(store.search(atlas, "Manager", "project", 20)).toHaveLength(12);
    expect(store.search(atlas, "Shared", "project")).toHaveLength(1);
  } finally {
    store?.close();
    await fixture.cleanup();
  }
}, 15000);
