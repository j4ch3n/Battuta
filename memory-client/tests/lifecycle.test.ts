import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { CaptureQueue } from "../capture-queue.ts";
import { CaptureRuntime } from "../lifecycle.ts";

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    type: "message",
    id: String(i),
    message: { role: i % 2 ? "assistant" : "user", content: `fact ${i}` },
  }));
test("oversized memories allow one durable rephrase, not repeated paid extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "pm");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
    let now = 0;
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload: () => Promise.reject(Object.assign(new Error("too long"), { rephrase: true })),
      now: () => now,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], "atlas");
    await runtime.settle("s", entries(6));
    now = 2000;
    await runtime.recover();
    now = 100000;
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(queue.jobs()).toHaveLength(1);
    expect(queue.jobs()[0].blocked).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("six-message trigger, project freeze, durable extraction and bounded upload retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "pm");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] }, usage: { input: 2 } }));
    const upload = vi.fn(() => Promise.reject(new Error("offline")));
    let now = 1000;
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload,
      now: () => now,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], "atlas");
    await runtime.settle("s", entries(2));
    expect(extract).not.toHaveBeenCalled();
    await runtime.settle("s", entries(6));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(queue.jobs()[0].segment.project).toBe("atlas");
    expect(queue.jobs()[0].batch).toEqual({ items: [] });
    now += 2000;
    await runtime.startRequest("s", entries(6), "beacon");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    await runtime.settle("s", entries(6));
    expect(queue.pending("s")).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("boundary flush queues short batches; a fork does not backfill old history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "tl");
    const extract = vi.fn(() => Promise.reject(new Error("no model")));
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], "atlas");
    await runtime.flush("s", entries(2));
    expect(queue.jobs()).toHaveLength(1);
    await runtime.initialize("fork", entries(2));
    expect(queue.pending("fork")).toEqual([]);
    await runtime.startRequest("fork", entries(2), "beacon");
    expect(queue.jobs()[0].segment.project).toBe("atlas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("shutdown aborts an active worker and never acknowledges its queued batch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "pm");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = new CaptureRuntime(queue, {
      extract: async (_job, signal) => {
        started();
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        );
        return { batch: {} };
      },
      upload: () => Promise.reject(new Error("must not upload")),
      now: () => 0,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], "atlas");
    const settling = runtime.settle("s", entries(6));
    await ready;
    runtime.shutdown();
    await settling;
    expect(queue.jobs()).toHaveLength(1);
    expect(queue.jobs()[0].batch).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
