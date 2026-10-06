import { resolveBinding, type ProjectBinding } from "./binding.ts";
import type { SessionEntry } from "./stone.ts";
import type { MemoryStore } from "./store.ts";
import type { MemoryConfig } from "./config.ts";
import { injectMemory } from "./injection.ts";
import { randomUUID } from "node:crypto";
import { captureJob, IndexQueue } from "./index-queue.ts";

interface RequestSnapshot {
  id: string;
  binding: ProjectBinding | null;
  error?: string;
  previousEntries: Set<string>;
}
export class MemoryRuntime {
  readonly store: MemoryStore;
  private readonly root: string;
  private readonly requests = new Map<string, RequestSnapshot>();
  private readonly invalidatedRecall = new Set<string>();
  private readonly queue: IndexQueue;
  constructor(store: MemoryStore, root: string) {
    this.store = store;
    this.root = root;
    this.queue = new IndexQueue(store);
    this.recover();
  }

  async start(sessionId: string, branch: SessionEntry[]) {
    this.recover();
    this.invalidatedRecall.delete(sessionId);
    let binding: ProjectBinding | null = null;
    let error: string | undefined;
    try {
      binding = await resolveBinding(this.root);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    this.requests.set(sessionId, {
      id: randomUUID(),
      binding,
      error,
      previousEntries: new Set(branch.map((entry) => entry.id)),
    });
  }

  async binding(sessionId: string): Promise<ProjectBinding | null> {
    const request = this.requests.get(sessionId);
    if (request) return request.binding;
    try {
      return await resolveBinding(this.root);
    } catch {
      return null;
    }
  }

  status(sessionId: string) {
    return this.requests.get(sessionId);
  }

  inject(sessionId: string, prompt: string, config: MemoryConfig) {
    return injectMemory(
      this.store,
      this.requests.get(sessionId)?.binding ?? null,
      sessionId,
      prompt,
      config,
    );
  }

  finish(sessionId: string, sessionFile: string | undefined, branch: SessionEntry[]) {
    const request = this.requests.get(sessionId);
    if (!request) {
      this.recover();
      return;
    }
    const entries = branch.filter((entry) => !request.previousEntries.has(entry.id));
    const job =
      request.binding && sessionFile && entries.length
        ? captureJob(this.store, request.id, request.binding, sessionId, sessionFile, entries)
        : undefined;
    this.requests.delete(sessionId);
    if (job) this.queue.settle(job);
  }

  recover() {
    this.queue.recover();
  }
  recoveryWarnings() {
    return this.queue.warnings();
  }

  reset(sessionId: string) {
    this.requests.delete(sessionId);
    this.invalidatedRecall.delete(sessionId);
  }

  invalidateRecall(sessionId: string) {
    this.invalidatedRecall.add(sessionId);
  }

  recallInvalidated(sessionId: string) {
    return this.invalidatedRecall.has(sessionId);
  }
}
