import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { collectMessages, splitSegments, type CaptureSegment } from "./session-messages.ts";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export interface CaptureJob {
  id: string;
  session_id: string;
  segment: CaptureSegment;
  batch?: Record<string, unknown>;
  attempts: number;
  nextAttempt: number;
}
interface State {
  version: 1;
  seen: Record<string, string[]>;
  pending: Record<string, CaptureSegment[]>;
  jobs: CaptureJob[];
}

export class CaptureQueue {
  private constructor(
    readonly directory: string,
    readonly role: "pm" | "tl",
    private state: State,
  ) {}
  static async open(directory: string, role: "pm" | "tl") {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    let state: State = { version: 1, seen: {}, pending: {}, jobs: [] };
    try {
      state = JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (state.version !== 1 || !state.seen || !state.pending || !Array.isArray(state.jobs))
      throw new Error("Invalid capture queue");
    return new CaptureQueue(directory, role, state);
  }
  private async save(next: State) {
    const temporary = join(this.directory, `.state-${randomUUID()}`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(next));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.directory, "state.json"));
      const dir = await open(this.directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      this.state = next;
    } finally {
      await unlink(temporary).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
  pending(session: string) {
    return structuredClone(this.state.pending[session] ?? []);
  }
  jobs() {
    return structuredClone(this.state.jobs);
  }
  async track(
    session: string,
    entries: readonly unknown[],
    project: string | null,
    flush: boolean,
  ) {
    const next = structuredClone(this.state);
    const messages = collectMessages(entries);
    if (!Object.hasOwn(next.seen, session)) {
      next.seen[session] = messages.map((m) => m.entry_id);
    } else {
      const seen = new Set(next.seen[session]);
      const fresh = messages.filter((m) => !seen.has(m.entry_id));
      next.seen[session] = [...new Set([...next.seen[session], ...fresh.map((m) => m.entry_id)])];
      const pending = next.pending[session] ?? [];
      const tail = pending.at(-1);
      if (fresh.length) {
        if (tail && tail.project === project) tail.messages.push(...fresh);
        else pending.push({ project, messages: fresh });
      }
      next.pending[session] = pending;
    }
    await this.save(next);
    if (flush) await this.flush(session);
  }
  async flush(session: string) {
    const next = structuredClone(this.state);
    for (const pending of next.pending[session] ?? []) {
      for (const segment of splitSegments(pending.messages, pending.project)) {
        const id = digest([this.role, session, segment]);
        if (!next.jobs.some((j) => j.id === id))
          next.jobs.push({ id, session_id: session, segment, attempts: 0, nextAttempt: 0 });
      }
    }
    delete next.pending[session];
    await this.save(next);
  }
  async update(job: CaptureJob) {
    const next = structuredClone(this.state);
    const i = next.jobs.findIndex((j) => j.id === job.id);
    if (i < 0) throw new Error("Unknown capture job");
    next.jobs[i] = structuredClone(job);
    await this.save(next);
  }
  async markUploaded(jobId: string) {
    const next = structuredClone(this.state);
    next.jobs = next.jobs.filter((j) => j.id !== jobId);
    await this.save(next);
  }
}
