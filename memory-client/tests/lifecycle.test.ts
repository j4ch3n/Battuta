import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { CaptureQueue } from "../capture-queue.ts";
import { CaptureRuntime } from "../lifecycle.ts";
import type { RequestBinding } from "../binding.ts";

const binding = (project: string | null, session_id = "s"): RequestBinding => ({
  request_id: `${session_id}-${project}`,
  conversation_id: session_id,
  session_id,
  project,
  origin: "owner",
  admitted_at: "2026-11-06T10:00:00Z",
});

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    type: "message",
    id: String(i),
    message: { role: i === 0 ? "user" : "assistant", content: `fact ${i}` },
  }));

test.each([false, true])(
  "queued mail without matching admission is retained unbound, not captured under the active project (marker=%s)",
  async (marker) => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-unbound-"));
    try {
      const queue = await CaptureQueue.open(dir, "cos");
      const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
      const runtime = new CaptureRuntime(queue, {
        extract,
        upload: async () => {},
        now: () => 0,
        notify: () => {},
      });
      const owner = binding("atlas");
      await runtime.startRequest("s", [], owner);
      const branch = [
        { type: "custom", customType: "memory-request", data: owner },
        ...entries(2),
        ...(marker
          ? [
              {
                type: "custom",
                customType: "memory-request-origin",
                data: {
                  ...owner,
                  request_id: "mail",
                  conversation_id: "beacon-mail",
                  project: "beacon",
                  origin: "mail",
                },
              },
            ]
          : []),
        {
          id: "mail",
          type: "custom_message",
          customType: "agent-mail",
          content: JSON.stringify({
            message_ref: { conversation_id: "beacon-mail", id: "abcdef123456" },
            sender: "manager",
            content: { summary: "Beacon uses Postgres" },
          }),
        },
      ];
      await runtime.settle("s", branch);
      await runtime.recover();
      expect(extract).not.toHaveBeenCalled();
      expect(queue.jobs()[0]).toMatchObject({
        blocked: true,
        blocked_reason: "unbound-origin",
        segment: { project: null },
      });
      expect(queue.jobs()[0].segment.binding).toBeUndefined();
      expect(
        queue
          .jobs()[0]
          .segment.messages.some(
            (m) => m.original_mail?.message_ref.conversation_id === "beacon-mail",
          ),
      ).toBe(true);
      expect(runtime.hasPendingCapture()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("compaction flush preserves capture binding for the continued request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-compact-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      extract: () => Promise.reject(new Error("offline")),
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", [], binding("atlas"));
    await runtime.flush("s", entries(2));
    await runtime.settle("s", entries(4));
    await runtime.recover();
    expect(
      queue
        .jobs()
        .flatMap((j) => j.segment.messages)
        .map((m) => m.entry_id),
    ).toEqual(["0", "1", "2", "3"]);
    expect(queue.jobs().every((j) => j.segment.project === "atlas")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([true, false])(
  "only the exact admitted mail envelope may share a binding (same=%s)",
  async (same) => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-mail-"));
    try {
      const queue = await CaptureQueue.open(dir, "cos");
      const runtime = new CaptureRuntime(queue, {
        extract: () => Promise.reject(new Error("offline")),
        upload: async () => {},
        now: () => 0,
        notify: () => {},
      });
      const admitted = {
        ...binding("atlas"),
        origin: "mail" as const,
        mail_ref: { conversation_id: "s", id: "admitted" },
      };
      await runtime.startRequest("s", [], admitted);
      await runtime.flush("s", [
        { type: "custom", customType: "memory-request", data: admitted },
        {
          id: "mail",
          type: "custom_message",
          customType: "agent-mail",
          content: JSON.stringify({
            message_ref: { ...admitted.mail_ref, id: same ? "admitted" : "queued" },
            sender: "manager",
            content: { summary: "Report" },
          }),
        },
      ]);
      expect(queue.jobs()[0].blocked ?? false).toBe(!same);
      expect(queue.jobs()[0].segment.project).toBe(same ? "atlas" : null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("oversized memories allow one durable rephrase, not repeated paid extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
    let now = 0;
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload: () => Promise.reject(Object.assign(new Error("too long"), { rephrase: true })),
      now: () => now,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], binding("atlas"));
    await runtime.settle("s", entries(6));
    await runtime.recover();
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
test("settled turn queues immediately with project freeze and bounded upload retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
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
    await runtime.startRequest("s", [], binding("atlas"));
    await runtime.settle("s", entries(2));
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(runtime.hasPendingCapture()).toBe(true);
    await runtime.settle("s", entries(6));
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(queue.jobs()[0].segment.project).toBe("atlas");
    expect(queue.jobs()[0].batch).toEqual({ items: [] });
    now += 2000;
    await runtime.startRequest("s", entries(6), binding("beacon"));
    expect(extract).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(2);
    await runtime.recover();
    expect(upload).toHaveBeenCalledTimes(4);
    await runtime.settle("s", entries(6));
    expect(queue.pending("s")).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("boundary flush queues short batches; a fork does not backfill old history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
  try {
    const queue = await CaptureQueue.open(dir, "manager");
    const extract = vi.fn(() => Promise.reject(new Error("no model")));
    const runtime = new CaptureRuntime(queue, {
      extract,
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], binding("atlas"));
    await runtime.flush("s", entries(2));
    expect(queue.jobs()).toHaveLength(1);
    await runtime.initialize("fork", entries(2));
    expect(queue.pending("fork")).toEqual([]);
    await runtime.startRequest("fork", entries(2), binding("beacon", "fork"));
    expect(queue.jobs()[0].segment.project).toBe("atlas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("shutdown aborts an active worker and never acknowledges its queued batch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-test-"));
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
    await runtime.initialize("s", []);
    await runtime.startRequest("s", [], binding("atlas"));
    const settling = runtime.settle("s", entries(6));
    await ready;
    runtime.shutdown();
    await settling;
    await runtime.recover();
    expect(queue.jobs()).toHaveLength(1);
    expect(queue.jobs()[0].batch).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("interleaved sessions keep their own binding; unbound turns never become global facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-binding-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      extract: () => Promise.reject(new Error("offline")),
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", [], binding("atlas"));
    await runtime.startRequest("other", [], binding("beacon", "other"));
    await runtime.flush("s", entries(2));
    await runtime.flush("other", entries(2));
    expect(queue.jobs().map((j) => j.segment.project)).toEqual(["atlas", "beacon"]);
    expect(queue.jobs()[0].segment.binding?.request_id).toBe("s-atlas");
    await runtime.startRequest("unknown", [], undefined);
    await runtime.flush("unknown", entries(2));
    expect(queue.jobs()).toHaveLength(2);
    await runtime.startRequest("general", [], binding(null, "general"));
    await runtime.flush("general", entries(2));
    expect(queue.jobs().at(-1)?.segment.project).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
