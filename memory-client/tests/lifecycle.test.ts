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
    message: { role: i === 0 ? "user" : "assistant", content: `fact ${i}` },
  }));
const request = (project: string | null) => ({ capture: true, project });

test("compaction preserves explicit scope, capture retries are frozen, and a fork does not backfill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
    const upload = vi.fn(() => Promise.reject(new Error("offline")));
    let now = 0;
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload,
      now: () => now,
      notify: () => {},
    });
    await runtime.startRequest("s", [], request("atlas"));
    await runtime.flush("s", entries(2));
    await runtime.settle("s", entries(4));
    await runtime.recover();
    expect(queue.jobs().flatMap((j) => j.segment.messages.map((m) => m.entry_id))).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(queue.jobs().every((j) => j.segment.project === "atlas")).toBe(true);
    expect(extract).toHaveBeenCalledTimes(2);
    now = 2000;
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(4);
    await runtime.initialize("fork", entries(4));
    await runtime.startRequest("fork", entries(4), request("beacon"));
    await runtime.settle("fork", entries(4));
    expect(queue.jobs()).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversized memories allow one durable rephrase, not repeated paid extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
    let now = 0;
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload: () => Promise.reject(Object.assign(new Error("long"), { rephrase: true })),
      now: () => now,
      notify: () => {},
    });
    await runtime.startRequest("s", [], request(null));
    await runtime.settle("s", entries(2));
    await runtime.recover();
    now = 2000;
    await runtime.recover();
    now = 100000;
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(queue.jobs()[0].blocked).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mail remains attributed while internal runs are excluded and sessions keep their scope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      extract: () => Promise.reject(new Error("offline")),
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", [], request("atlas"));
    await runtime.startRequest("other", [], request("beacon"));
    await runtime.flush("s", [
      {
        id: "mail",
        type: "custom_message",
        customType: "agent-mail",
        content: JSON.stringify({
          message_ref: { conversation_id: "c", id: "m" },
          sender: "manager",
          content: { summary: "Report" },
        }),
      },
    ]);
    await runtime.flush("other", entries(2));
    expect(queue.jobs().map((j) => j.segment.project)).toEqual(["atlas", "beacon"]);
    expect(queue.jobs()[0].segment.messages[0]).toMatchObject({
      speaker: "agent",
      original_mail: { sender: "manager" },
    });
    await runtime.startRequest("internal", [], { capture: false, project: null });
    await runtime.settle("internal", entries(2));
    expect(queue.jobs()).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown cancels extraction without acknowledging its queued batch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
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
    await runtime.startRequest("s", [], request(null));
    await runtime.settle("s", entries(2));
    await ready;
    runtime.shutdown();
    await runtime.recover();
    expect(queue.jobs()).toHaveLength(1);
    expect(queue.jobs()[0].batch).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
