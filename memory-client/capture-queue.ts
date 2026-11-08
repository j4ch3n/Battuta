import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  collectMessages,
  hasUnboundOrigin,
  splitSegments,
  type CaptureSegment,
} from "./session-messages.ts";
import type { RequestBinding } from "./binding.ts";
import { normalizePersistedCapture } from "./delivery-compat.ts";

import { digest } from "./canonical.ts";
export { canonical, digest } from "./canonical.ts";
export interface CaptureJob {
  project_catalog?: string[];
  project_rejections?: { index: number; item: Record<string, unknown> }[];
  project_inputs?: { index: number; item: Record<string, unknown> }[];
  rephrase_inputs?: { index: number; item: Record<string, unknown> }[];
  project_attempt_started?: boolean;
  rephrase_started?: boolean;
  projectAttempts?: number;
  batch_uploaded?: boolean;
  legacy_delivery?: boolean;
  rephraseAttempts?: number;
  blocked?: boolean;
  blocked_reason?: "unbound-origin";
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

export async function readCapturePending(directory: string) {
  try {
    const raw = await readFile(join(directory, "state.json"), "utf8");
    if (Buffer.byteLength(raw) > 4000000) throw new Error("Capture queue exceeds inspection limit");
    const state = JSON.parse(raw) as State;
    if (state.version !== 1 || !Array.isArray(state.jobs) || !state.pending)
      throw new Error("Invalid capture queue");
    return (
      state.jobs.length > 0 ||
      Object.values(state.pending).some((segments) => segments.some((s) => s.messages.length > 0))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class CaptureQueue {
  private changes = Promise.resolve();
  private change(action: () => Promise<void>) {
    const pending = this.changes.then(action);
    this.changes = pending.catch(() => {});
    return pending;
  }
  private constructor(
    readonly directory: string,
    readonly role: "cos" | "manager",
    private state: State,
  ) {}
  static async open(directory: string, role: "cos" | "manager") {
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
    for (const job of state.jobs) {
      if (
        job.batch &&
        Array.isArray(job.batch.items) &&
        job.batch.items.some(
          (item: unknown) => !!item && typeof item === "object" && "scope" in item,
        )
      ) {
        const copy = normalizePersistedCapture(job.batch);
        job.project_catalog = [
          ...new Set(copy.items.flatMap((item) => item.projects as string[])),
        ].sort();
        job.legacy_delivery = true;
      }
    }
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
  hasPending() {
    return (
      this.state.jobs.length > 0 ||
      Object.values(this.state.pending).some((segments) =>
        segments.some((s) => s.messages.length > 0),
      )
    );
  }
  async track(
    session: string,
    entries: readonly unknown[],
    project: string | null,
    flush: boolean,
    binding?: RequestBinding,
    capture = true,
  ) {
    return this.change(async () => {
      const next = structuredClone(this.state);
      const messages = collectMessages(entries);
      if (!Object.hasOwn(next.seen, session)) {
        next.seen[session] = messages.map((m) => m.entry_id);
      } else {
        const seen = new Set(next.seen[session]);
        const fresh = messages.filter((m) => !seen.has(m.entry_id));
        const unbound = !!binding && hasUnboundOrigin(entries, binding);
        if (unbound) {
          project = null;
          binding = undefined;
        }
        next.seen[session] = [...new Set([...next.seen[session], ...fresh.map((m) => m.entry_id)])];
        const pending = next.pending[session] ?? [];
        const tail = pending.at(-1);
        if (capture && fresh.length) {
          if (
            tail &&
            tail.project === project &&
            tail.binding?.request_id === binding?.request_id &&
            !unbound
          )
            tail.messages.push(...fresh);
          else
            pending.push({
              project,
              messages: fresh,
              ...(unbound ? { blocked_reason: "unbound-origin" as const } : {}),
              ...(binding ? { binding: structuredClone(binding) } : {}),
            });
        }
        next.pending[session] = pending;
      }
      await this.save(next);
      if (flush) await this.flushNow(session);
    });
  }
  async flush(session: string) {
    return this.change(() => this.flushNow(session));
  }
  private async flushNow(session: string) {
    const next = structuredClone(this.state);
    for (const pending of next.pending[session] ?? []) {
      for (const segment of splitSegments(pending.messages, pending.project)) {
        if (pending.binding) segment.binding = pending.binding;
        const id = digest([this.role, session, segment]);
        if (!next.jobs.some((j) => j.id === id))
          next.jobs.push({
            id,
            session_id: session,
            segment,
            attempts: 0,
            nextAttempt: 0,
            ...(pending.blocked_reason
              ? { blocked: true, blocked_reason: pending.blocked_reason }
              : {}),
          });
      }
    }
    delete next.pending[session];
    await this.save(next);
  }
  async update(job: CaptureJob) {
    return this.change(async () => {
      const next = structuredClone(this.state);
      const i = next.jobs.findIndex((j) => j.id === job.id);
      if (i < 0) throw new Error("Unknown capture job");
      next.jobs[i] = structuredClone(job);
      await this.save(next);
    });
  }
  async markUploaded(jobId: string) {
    return this.change(async () => {
      const next = structuredClone(this.state);
      next.jobs = next.jobs.filter((j) => j.id !== jobId);
      await this.save(next);
    });
  }
}
