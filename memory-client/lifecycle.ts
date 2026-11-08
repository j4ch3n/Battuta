import type { CaptureJob, CaptureQueue } from "./capture-queue.ts";
import { normalizePersistedCapture } from "./delivery-compat.ts";
import { z } from "zod";

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
  private requests = new Map<string, { capture: boolean; project: string | null }>();
  private active?: AbortController;
  private recovery?: Promise<void>;
  private stopped = false;
  constructor(
    readonly queue: CaptureQueue,
    private worker: Worker,
  ) {}
  async initialize(session: string, entries: readonly unknown[]) {
    this.requests.delete(session);
    await this.queue.track(session, entries, null, false);
    this.initialized.add(session);
  }
  async startRequest(
    session: string,
    entries: readonly unknown[],
    options: { capture: boolean; project: string | null } = { capture: true, project: null },
    signal?: AbortSignal,
  ) {
    // Session initialization must precede the first persisted request.
    if (!this.initialized.has(session)) {
      await this.initialize(session, entries);
      this.initialized.add(session);
    }
    signal?.throwIfAborted();
    this.requests.set(session, structuredClone(options));
  }
  private initialized = new Set<string>();
  async settle(session: string, entries: readonly unknown[]) {
    const request = this.requests.get(session);
    if (!request?.capture) {
      await this.queue.track(session, entries, null, false, false);
      return;
    }
    await this.queue.track(session, entries, request.project, false);
    await this.queue.flush(session);
    void this.recover().catch(() =>
      this.worker.notify("Memory capture pending; retained for retry"),
    );
  }
  async flush(session: string, entries: readonly unknown[], endRequest = false) {
    const request = this.requests.get(session);
    await this.queue.track(session, entries, request?.project ?? null, true, !!request?.capture);
    if (endRequest) this.requests.delete(session);
  }
  async beforeCompact(session: string, entries: readonly unknown[]) {
    await this.flush(session, entries);
    void this.recover().catch(() =>
      this.worker.notify("Memory capture pending; retained for retry"),
    );
  }
  shutdown() {
    this.stopped = true;
    this.active?.abort();
  }
  hasPendingCapture() {
    return this.queue.hasPending();
  }
  recover(): Promise<void> {
    if (this.stopped) return this.recovery ?? Promise.resolve();
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
      if (this.stopped) break;
      const controller = new AbortController();
      this.active = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      let extractingCorrection = false;
      try {
        if (!job.batch) {
          if (!job.project_catalog) {
            job.project_catalog = await this.worker.prepare(job, signal);
            signal.throwIfAborted();
            await this.queue.update(job);
          }
          signal.throwIfAborted();
          if (job.rephrase_inputs?.length || job.project_inputs?.length) {
            const marker = job.rephrase_inputs?.length
              ? "rephrase_started"
              : "project_attempt_started";
            if (job[marker]) {
              job.blocked = true;
              throw new Error("Capture correction attempt exhausted");
            }
            job[marker] = true;
            await this.queue.update(job);
            signal.throwIfAborted();
            extractingCorrection = true;
          }
          const result = await this.worker.extract(job, signal);
          signal.throwIfAborted();
          extractingCorrection = false;
          job.batch = result.batch;
          job.project_rejections = job.rephrase_inputs?.length
            ? [...(job.project_rejections ?? []), ...(result.project_rejections ?? [])]
            : result.project_rejections;
          job.batch_uploaded = false;
          await this.queue.update(job);
        }
        if (!job.batch_uploaded) {
          signal.throwIfAborted();
          await this.worker.upload(
            job.legacy_delivery ? normalizePersistedCapture(job.batch) : job.batch,
            signal,
            job.project_catalog ??
              (Array.isArray(job.batch.items) && job.batch.items.length === 0
                ? ["global"]
                : undefined),
          );
          signal.throwIfAborted();
          job.batch_uploaded = true;
          await this.queue.update(job);
        }
        signal.throwIfAborted();
        delete job.rephrase_inputs;
        if (job.project_rejections?.length) {
          if (job.projectAttempts) job.blocked = true;
          else {
            job.projectAttempts = 1;
            job.project_inputs = job.project_rejections;
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
            const batch =
              job.legacy_delivery && job.batch ? normalizePersistedCapture(job.batch) : job.batch;
            const items = z.array(z.record(z.string(), z.unknown())).parse(batch?.items ?? []);
            const failed =
              "rephrase_items" in error
                ? z.array(z.string()).nonempty().parse(error.rephrase_items)
                : items.map((item) => String(item.item_id));
            if (failed.some((id) => !items.some((item) => item.item_id === id)))
              throw new Error("Invalid embedding-limit receipt", { cause: error });
            job.rephrase_inputs = items
              .filter((item) => failed.includes(String(item.item_id)))
              .map((item) => {
                const index = Number(String(item.item_id).split(":").at(-1));
                if (!Number.isInteger(index) || index < 0)
                  throw new Error("Invalid capture item identity");
                const metadata = z
                  .record(z.string(), z.unknown())
                  .nullish()
                  .parse(item.memory_metadata);
                return {
                  index,
                  item: {
                    ...item,
                    source_entry_ids: z
                      .array(z.object({ entry_id: z.string() }))
                      .parse(item.sources)
                      .map((source) => source.entry_id),
                    keywords: metadata?.keywords ?? [],
                    confidence: metadata?.confidence ?? "tentative",
                    expires_at: metadata?.expires_at ?? null,
                  },
                };
              });
            delete job.batch;
          }
        }
        if (extractingCorrection) job.blocked = true;
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
