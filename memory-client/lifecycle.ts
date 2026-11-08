import type { CaptureJob, CaptureQueue } from "./capture-queue.ts";
import type { RequestBinding } from "./binding.ts";

interface Worker {
  prepare: (job: CaptureJob, signal: AbortSignal) => Promise<string[]>;
  extract: (
    job: CaptureJob,
    signal: AbortSignal,
  ) => Promise<{
    batch: Record<string, unknown>;
    project_rejections?: CaptureJob["project_rejections"];
    usage?: unknown;
  }>;
  upload: (
    batch: Record<string, unknown>,
    signal: AbortSignal,
    catalog?: readonly string[],
  ) => Promise<unknown>;
  now: () => number;
  notify: (message: string) => void;
}
export class CaptureRuntime {
  private bindings = new Map<string, RequestBinding>();
  private active?: AbortController;
  private recovery?: Promise<void>;
  constructor(
    readonly queue: CaptureQueue,
    private worker: Worker,
  ) {}
  async initialize(session: string, entries: readonly unknown[]) {
    this.bindings.delete(session);
    await this.queue.track(session, entries, null, false);
    this.initialized.add(session);
  }
  async startRequest(
    session: string,
    entries: readonly unknown[],
    binding?: RequestBinding,
    signal?: AbortSignal,
  ) {
    // Session initialization must precede the first persisted request.
    if (!this.initialized.has(session)) {
      await this.initialize(session, entries);
      this.initialized.add(session);
    }
    signal?.throwIfAborted();
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
    await this.queue.flush(session);
    void this.recover().catch(() =>
      this.worker.notify("Memory capture pending; retained for retry"),
    );
  }
  async flush(session: string, entries: readonly unknown[], endRequest = false) {
    const binding = this.bindings.get(session);
    await this.queue.track(session, entries, binding?.project ?? null, true, binding, !!binding);
    if (endRequest) this.bindings.delete(session);
  }
  shutdown() {
    this.active?.abort();
  }
  hasPendingCapture() {
    return this.queue.hasPending();
  }
  recover(): Promise<void> {
    if (!this.recovery)
      this.recovery = this.runRecovery().finally(() => {
        this.recovery = undefined;
      });
    return this.recovery;
  }
  private async runRecovery() {
    for (const job of this.queue
      .jobs()
      .filter((j) => !j.blocked && j.nextAttempt <= this.worker.now())
      .slice(0, 2)) {
      const controller = new AbortController();
      this.active = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      try {
        if (!job.batch) {
          if (!job.project_catalog) {
            job.project_catalog = await this.worker.prepare(job, signal);
            signal.throwIfAborted();
            await this.queue.update(job);
          }
          const result = await this.worker.extract(job, signal);
          signal.throwIfAborted();
          job.batch = result.batch;
          job.project_rejections = result.project_rejections;
          job.batch_uploaded = false;
          await this.queue.update(job);
        }
        if (!job.batch_uploaded) {
          await this.worker.upload(job.batch, signal, job.project_catalog);
          signal.throwIfAborted();
          job.batch_uploaded = true;
          await this.queue.update(job);
        }
        signal.throwIfAborted();
        if (job.project_rejections?.length) {
          if (job.projectAttempts) job.blocked = true;
          else {
            job.projectAttempts = 1;
            delete job.batch;
            delete job.batch_uploaded;
          }
          throw new Error("Project correction pending");
        }
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
