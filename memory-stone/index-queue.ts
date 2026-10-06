import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { ProjectBinding } from "./binding.ts";
import type { SessionEntry } from "./stone.ts";
import type { MemoryStore } from "./store.ts";
import { redactHistoryEntry, redactMemoryText } from "./privacy.ts";
import { indexRequest } from "./indexing.ts";

export interface IndexJob {
  version: 1;
  id: string;
  requestId: string;
  binding: ProjectBinding;
  sessionId: string;
  sessionFile: string;
  entries: SessionEntry[];
}
function identity(job: Omit<IndexJob, "id">): string {
  return createHash("sha256").update(JSON.stringify(job)).digest("hex");
}
export function captureJob(
  store: MemoryStore,
  requestId: string,
  binding: ProjectBinding,
  sessionId: string,
  sessionFile: string,
  entries: SessionEntry[],
): IndexJob {
  const payload = {
    version: 1 as const,
    requestId,
    binding: { ...binding },
    sessionId,
    sessionFile,
    entries: entries.map((entry) => redactHistoryEntry(store.stone, entry)),
  };
  return { ...payload, id: identity(payload) };
}
function regular(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Queue file must be a regular file");
}
function parseJob(text: string, expectedId: string): IndexJob {
  const value = JSON.parse(text) as IndexJob;
  if (
    !value ||
    value.version !== 1 ||
    value.id !== expectedId ||
    typeof value.requestId !== "string" ||
    !value.binding ||
    ![
      value.binding.name,
      value.binding.projectId,
      value.binding.checkout,
      value.sessionId,
      value.sessionFile,
    ].every((part) => typeof part === "string" && part.length > 0) ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.some(
      (entry) => !entry || typeof entry.id !== "string" || typeof entry.type !== "string",
    )
  )
    throw new Error("Invalid indexing job");
  const { id, ...payload } = value;
  if (identity(payload) !== id) throw new Error("Indexing job identity mismatch");
  return value;
}

// The filesystem journal survives SQLite write failures. Its content is already
// redacted; completion identity is committed in SQLite alongside indexed rows.
export class IndexQueue {
  readonly directory: string;
  private readonly pending = new Map<string, IndexJob>();
  private issues: string[] = [];
  constructor(private readonly store: MemoryStore) {
    this.directory = `${store.path}.queue`;
  }
  warnings() {
    return [...this.issues];
  }
  private ensureDirectory() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new Error("Index queue requires a private real directory");
  }
  private atomic(path: string, content: string) {
    const temporary = `${path}.${process.pid}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temporary, path);
      const dir = openSync(this.directory, "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* renamed or retained for inspection */
      }
    }
  }
  private persist(job: IndexJob) {
    this.ensureDirectory();
    const file = join(this.directory, `${job.id}.job.json`);
    try {
      regular(file);
      if (readFileSync(file, "utf8") !== JSON.stringify(job))
        throw new Error("Immutable indexing job conflict");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.atomic(file, JSON.stringify(job));
    }
  }
  enqueue(job: IndexJob) {
    this.pending.set(job.id, job);
    try {
      this.persist(job);
      this.pending.delete(job.id);
    } catch (error) {
      this.issues = [
        "Index queue persistence failed; work retained only in this process, not durable across a crash.",
      ];
      throw new Error(this.issues[0], { cause: error });
    }
  }
  recover(limit = 10) {
    this.issues = [];
    try {
      this.ensureDirectory();
    } catch {
      this.issues.push("Index queue unavailable; retained in-process jobs are not crash-durable.");
      return;
    }
    // One queue-wide leased claim serializes consumers, including pending-job
    // publication. Abandoned claims are reclaimed by proper-lockfile.
    let release: (() => void) | undefined;
    try {
      release = lockfile.lockSync(this.directory, { stale: 120000, retries: 0 });
    } catch {
      return;
    }
    try {
      for (const job of this.pending.values()) {
        try {
          this.persist(job);
          this.pending.delete(job.id);
        } catch {
          this.issues.push("Index queue persistence failed; pending work is not crash-durable.");
          break;
        }
      }
      let attempted = 0;
      for (const name of readdirSync(this.directory).sort()) {
        if (!/^[a-f0-9]{64}\.job\.json$/.test(name)) continue;
        const file = join(this.directory, name);
        const retryFile = `${file}.retry.json`;
        let job: IndexJob;
        let attempts = 0;
        try {
          regular(file);
          job = parseJob(readFileSync(file, "utf8"), name.slice(0, 64));
          try {
            regular(retryFile);
            const retry = JSON.parse(readFileSync(retryFile, "utf8")) as {
              attempts: number;
              nextAt: number;
            };
            if (
              !Number.isSafeInteger(retry.attempts) ||
              retry.attempts < 0 ||
              !Number.isFinite(retry.nextAt)
            )
              throw new Error("Invalid retry state");
            attempts = retry.attempts;
            if (retry.nextAt > Date.now()) continue;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        } catch {
          this.issues.push(`Malformed indexing job retained for inspection: ${name}`);
          continue;
        }
        if (attempted++ >= limit) break;
        try {
          indexRequest(
            this.store,
            job.binding,
            job.sessionId,
            job.sessionFile,
            job.entries,
            job.id,
          );
          unlinkSync(file);
          try {
            unlinkSync(retryFile);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        } catch (error) {
          this.issues.push(
            `Indexing job retained for retry: ${job.id}: ${redactMemoryText(this.store.stone, String(error))}`,
          );
          try {
            this.atomic(
              retryFile,
              JSON.stringify({
                attempts: attempts + 1,
                nextAt: Date.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
              }),
            );
          } catch {
            this.issues.push("Index retry backoff could not be persisted.");
          }
        }
      }
    } finally {
      release();
    }
  }
  settle(job: IndexJob) {
    this.enqueue(job);
    this.recover();
    if (this.issues.length) throw new Error(this.issues.join(" "));
  }
}
