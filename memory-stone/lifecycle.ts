import { resolveBinding, type ProjectBinding } from "./binding.ts";
import type { SessionEntry } from "./stone.ts";
import type { MemoryStore } from "./store.ts";
import type { MemoryConfig } from "./config.ts";
import { indexRequest } from "./indexing.ts";
import { injectMemory } from "./injection.ts";

interface RequestSnapshot {
  binding: ProjectBinding | null;
  error?: string;
  previousEntries: Set<string>;
}
export class MemoryRuntime {
  readonly store: MemoryStore;
  private readonly root: string;
  private readonly requests = new Map<string, RequestSnapshot>();
  constructor(store: MemoryStore, root: string) {
    this.store = store;
    this.root = root;
  }

  async start(sessionId: string, branch: SessionEntry[]) {
    let binding: ProjectBinding | null = null;
    let error: string | undefined;
    try {
      binding = await resolveBinding(this.root);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    this.requests.set(sessionId, {
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
    if (!request) return;
    if (request.binding && sessionFile)
      indexRequest(
        this.store,
        request.binding,
        sessionId,
        sessionFile,
        branch.filter((entry) => !request.previousEntries.has(entry.id)),
      );
    this.requests.delete(sessionId);
  }

  reset(sessionId: string) {
    this.requests.delete(sessionId);
  }
}
