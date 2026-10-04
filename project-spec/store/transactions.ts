import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { atomicWrite, directory, readOptional, setMode, syncDirectory } from "./files.ts";
import { emptyMetadata, parseMetadata, readMetadata, type Metadata } from "./metadata.ts";
import type { SpecStorage } from "./storage.ts";

export interface Change {
  path: string;
  content?: string;
  mode: number;
  create?: boolean;
}
const backup = Type.Union([
  Type.Object(
    { bytes: Type.String(), mode: Type.Integer({ minimum: 0, maximum: 511 }) },
    { additionalProperties: false },
  ),
  Type.Null(),
]);
const JournalSchema = Type.Object(
  {
    previous_index: backup,
    next_index: Type.String(),
    files: Type.Array(
      Type.Object(
        {
          path: Type.String({
            pattern:
              "^[a-z0-9]+(?:-[a-z0-9]+)*/(?:spec-v[1-9][0-9]*|checklist|review|decision)\\.md$",
          }),
          previous: backup,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
type Journal = Static<typeof JournalSchema>;

async function snapshot(path: string) {
  const bytes = await readOptional(path);
  return bytes === null
    ? null
    : { bytes: bytes.toString("base64"), mode: (await lstat(path)).mode & 0o777 };
}

async function restore(path: string, previous: Journal["previous_index"]) {
  await directory(dirname(path));
  await readOptional(path);
  if (previous) await atomicWrite(path, Buffer.from(previous.bytes, "base64"), previous.mode);
  else {
    await rm(path, { force: true });
    await syncDirectory(dirname(path));
  }
}

async function recover(project: SpecStorage) {
  const path = join(project.specs, ".project-spec-transaction.json");
  const bytes = await readOptional(path);
  if (!bytes) return;
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid document recovery journal");
  }
  if (!Value.Check(JournalSchema, value)) throw new Error("Invalid document recovery journal");
  parseMetadata(value.next_index);
  const index = join(project.specs, "index.json");
  if ((await readOptional(index))?.toString("utf8") !== value.next_index) {
    for (const file of value.files) await restore(join(project.specs, file.path), file.previous);
    await restore(index, value.previous_index);
  } else {
    // A prior rename may have succeeded while its directory sync failed.
    // Make the commit durable before discarding its only recovery record.
    await syncDirectory(project.specs);
  }
  await rm(path);
  await syncDirectory(project.specs);
}

export async function withLock<T>(project: SpecStorage, operation: () => Promise<T>): Promise<T> {
  const existed = await directory(project.specs, true);
  await mkdir(project.specs, { recursive: true });
  await directory(project.specs);
  if (!existed) await syncDirectory(dirname(project.specs));
  const release = await lockfile.lock(project.specs, {
    retries: { retries: 40, minTimeout: 10, maxTimeout: 100, factor: 1.2 },
    stale: 10000,
  });
  try {
    await recover(project);
    return await operation();
  } finally {
    await release();
  }
}

export async function inspect<T>(
  project: SpecStorage,
  operation: (metadata: Metadata) => Promise<T>,
) {
  if (!(await directory(project.specs, true))) return operation(emptyMetadata());
  return withLock(project, async () => operation(await readMetadata(project)));
}

export async function loadMetadata(project: SpecStorage) {
  return inspect(project, (metadata) => Promise.resolve(metadata));
}

export async function mutate<T>(
  project: SpecStorage,
  operation: (metadata: Metadata) => Promise<{ result: T; changes: Change[] }>,
): Promise<T> {
  return withLock(project, async () => {
    const metadata = await readMetadata(project);
    const { result, changes } = await operation(metadata);
    const nextIndex = JSON.stringify(metadata, null, 2) + "\n";
    parseMetadata(nextIndex);
    const index = join(project.specs, "index.json");
    const journalPath = join(project.specs, ".project-spec-transaction.json");
    const journal: Journal = {
      previous_index: await snapshot(index),
      next_index: nextIndex,
      files: [],
    };
    for (const change of changes) {
      const path = join(project.specs, change.path);
      const relative = change.path;
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:spec-v[1-9][0-9]*|checklist|review|decision)\.md$/.test(
          relative,
        )
      )
        throw new Error("Invalid document path");
      const existed = await directory(dirname(path), true);
      await mkdir(dirname(path), { recursive: true });
      await directory(dirname(path));
      if (!existed) await syncDirectory(project.specs);
      const previous = await snapshot(path);
      if (change.create && previous)
        throw new Error(`Document already exists; it must not be overwritten: ${path}`);
      journal.files.push({ path: relative, previous });
    }
    await atomicWrite(journalPath, JSON.stringify(journal));
    try {
      for (const change of changes) {
        const path = join(project.specs, change.path);
        if (change.content === undefined) await setMode(path, change.mode);
        else await atomicWrite(path, change.content, change.mode);
      }
      await atomicWrite(index, nextIndex);
    } catch (error) {
      try {
        await recover(project);
      } catch {
        throw new Error(
          `Document write failed; recovery is pending. Read metadata before retrying: ${String(error)}`,
        );
      }
      throw error;
    }
    await recover(project); // Committed index: discard backups, never roll back a committed result.
    return result;
  });
}
