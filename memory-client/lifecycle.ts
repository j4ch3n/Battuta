import type { CaptureJob, CaptureQueue } from "./capture-queue.ts";
import type { RequestBinding } from "./binding.ts";

interface Worker {
  extract: (
    job: CaptureJob,
    signal: AbortSignal,
  ) => Promise<{ batch: Record<string, unknown>; usage?: unknown }>;
  upload: (batch: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  now: () => number;
  notify: (message: string) => void;
}
export class CaptureRuntime {
  private bindings = new Map<string, RequestBinding>();
  private active?: AbortController;
  constructor(
    readonly queue: CaptureQueue,
    private worker: Worker,
    readonly threshold = 6,
  ) {}
  async initialize(session: string, entries: readonly unknown[]) {
    this.bindings.delete(session);
    await this.queue.track(session, entries, null, false);
    this.initialized.add(session);
  }
  async startRequest(session: string, entries: readonly unknown[], binding?: RequestBinding) {
    // Session initialization must precede the first persisted request.
    if (!this.initialized.has(session)) {
      await this.initialize(session, entries);
      this.initialized.add(session);
    }
    this.bindings.delete(session);
    if (binding && binding.session_id !== session)
      throw new Error("Memory binding session mismatch");
    if (binding && binding.origin !== "internal")
      this.bindings.set(session, structuredClone(binding));
  }
  private initialized = new Set<string>();
  async settle(session: string, entries: readonly unknown[]) {
    const binding = this.bindings.get(session);
    if (!binding) {
      await this.queue.track(session, entries, null, false, undefined, false);
      return;
    }
    await this.queue.track(session, entries, binding.project, false, binding);
    const count = this.queue.pending(session).reduce((n, s) => n + s.messages.length, 0);
    if (count >= this.threshold) await this.queue.flush(session);
    await this.recover();
  }
  async flush(session: string, entries: readonly unknown[]) {
    const binding = this.bindings.get(session);
    await this.queue.track(session, entries, binding?.project ?? null, true, binding, !!binding);
    this.bindings.delete(session);
  }
  shutdown() {
    this.active?.abort();
  }
  async recover() {
    for (const job of this.queue
      .jobs()
      .filter((j) => !j.blocked && j.nextAttempt <= this.worker.now())
      .slice(0, 2)) {
      const controller = new AbortController();
      this.active = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      try {
        if (!job.batch) {
          const result = await this.worker.extract(job, signal);
          signal.throwIfAborted();
          job.batch = result.batch;
          await this.queue.update(job);
        }
        await this.worker.upload(job.batch, signal);
        signal.throwIfAborted();
        await this.queue.markUploaded(job.id);
      } catch (error) {
        if (error && typeof error === "object" && "rephrase" in error && error.rephrase) {
          if (job.rephraseAttempts) job.blocked = true;
          else {
            job.rephraseAttempts = 1;
            delete job.batch;
          }
        }
        job.attempts++;
        job.nextAttempt =
          this.worker.now() + Math.min(60000, 1000 * 2 ** Math.min(job.attempts - 1, 6));
        await this.queue.update(job);
        this.worker.notify("Memory capture pending; retained for retry");
      } finally {
        this.active = undefined;
      }
    }
  }
}
