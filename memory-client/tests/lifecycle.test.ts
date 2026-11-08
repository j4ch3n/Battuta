import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { CaptureQueue, type CaptureJob } from "../capture-queue.ts";
import { CaptureRuntime } from "../lifecycle.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractMemories } from "../extract.ts";

const prepare = () => Promise.resolve(["atlas", "beacon", "global"]);

test("embedding rephrase retains project rejections and rewrites only the failed frozen item", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-rephrase-projects-"));
  try {
    let now = 0;
    let calls = 0;
    const complete = vi.fn((_model: unknown, request: { messages: { content: string }[] }) => {
      calls++;
      const input = JSON.parse(request.messages[0].content) as {
        rejected_entries?: { index: number }[];
      };
      const items =
        calls === 1
          ? [
              { content: "An oversized atlas fact", projects: ["atlas"], source_entry_ids: ["0"] },
              {
                content: "Already saved short fact",
                projects: ["beacon"],
                source_entry_ids: ["0"],
              },
              { content: "Wrong project fact", projects: ["unknown"], source_entry_ids: ["0"] },
            ]
          : calls === 2
            ? [
                {
                  content: "Short atlas fact",
                  projects: ["atlas"],
                  source_entry_ids: ["0"],
                  ...(input.rejected_entries?.length ? { retry_entry_id: 0 } : {}),
                },
              ]
            : [
                {
                  content: "Corrected beacon fact",
                  projects: ["beacon"],
                  source_entry_ids: ["0"],
                  retry_entry_id: 2,
                },
              ];
      return Promise.resolve({
        stopReason: "stop",
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        usage: {},
      });
    });
    const ctx = {
      model: { id: "offline" },
      modelRegistry: { complete },
    } as unknown as ExtensionContext;
    const uploads: { items: { content: string; item_id: string }[] }[] = [];
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract: (job, signal) => extractMemories(job, ctx, signal),
      upload: (batch) => {
        const delivery = batch as (typeof uploads)[number];
        uploads.push(delivery);
        return uploads.length === 1
          ? Promise.reject(
              Object.assign(new Error("embedding limit"), {
                rephrase: true,
                rephrase_items: [delivery.items[0].item_id],
              }),
            )
          : Promise.resolve();
      },
      now: () => now,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(1));
    await runtime.recover();
    now = 2000;
    await runtime.recover();
    expect(queue.jobs()[0]?.project_rejections).toMatchObject([
      { index: 2, item: { projects: ["unknown"] } },
    ]);
    expect(uploads[1].items.map((item) => item.content)).toEqual(["Short atlas fact"]);
    now = 10000;
    await runtime.recover();
    expect(calls).toBe(3);
    expect(queue.jobs()).toEqual([]);
    expect(
      uploads
        .flatMap((batch) => batch.items)
        .filter((item) => item.content === "Already saved short fact"),
    ).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid correction completion consumes its single durable attempt across recovery and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-correction-limit-"));
  try {
    let now = 0;
    const rejected = [
      { index: 1, item: { content: "Unresolved", projects: ["unknown"], source_entry_ids: ["0"] } },
    ];
    const extract = vi.fn((job: CaptureJob) =>
      job.projectAttempts
        ? Promise.reject(new Error("Invalid correction JSON"))
        : Promise.resolve({ batch: { items: [] }, project_rejections: rejected }),
    );
    const worker = {
      prepare,
      extract,
      upload: () => Promise.resolve(),
      now: () => now,
      notify: () => {},
    };
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, worker);
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(1));
    await runtime.recover();
    for (now of [2000, 10000, 50000]) await runtime.recover();
    const restored = await CaptureQueue.open(dir, "cos");
    now = 100000;
    await new CaptureRuntime(restored, worker).recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(restored.jobs()[0]).toMatchObject({ blocked: true, project_rejections: rejected });
    expect(restored.jobs()[0].segment.messages[0].entry_id).toBe("0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a consumed correction attempt still retries its frozen upload without another completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-correction-upload-"));
  try {
    let now = 0,
      uploads = 0;
    const extract = vi.fn((job: CaptureJob) =>
      Promise.resolve(
        job.projectAttempts
          ? { batch: { batch_id: "corrected", items: [] }, project_rejections: [] }
          : {
              batch: { batch_id: "accepted", items: [] },
              project_rejections: [{ index: 1, item: { projects: ["unknown"] } }],
            },
      ),
    );
    const worker = {
      prepare,
      extract,
      upload: (batch: Record<string, unknown>) => {
        uploads++;
        return batch.batch_id === "corrected" && uploads === 2
          ? Promise.reject(new Error("lost ack"))
          : Promise.resolve();
      },
      now: () => now,
      notify: () => {},
    };
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, worker);
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(1));
    await runtime.recover();
    now = 2000;
    await runtime.recover();
    expect(queue.jobs()[0]).toMatchObject({
      project_attempt_started: true,
      batch: { batch_id: "corrected" },
    });
    expect(queue.jobs()[0].blocked).not.toBe(true);
    now = 10000;
    const restored = await CaptureQueue.open(dir, "cos");
    await new CaptureRuntime(restored, worker).recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(uploads).toBe(3);
    expect(restored.jobs()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("old frozen capture replays a copy with original digest and no catalog discovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-frozen-"));
  try {
    const batch = {
      batch_id: "original",
      payload_digest: "unchanged",
      items: [{ item_id: "original:0", scope: { global: false, projects: ["atlas"] } }],
    };
    const state = {
      version: 1,
      seen: {},
      pending: {},
      jobs: [
        {
          id: "frozen",
          session_id: "s",
          segment: { project: "atlas", messages: [] },
          batch,
          attempts: 0,
          nextAttempt: 0,
        },
      ],
    };
    await writeFile(join(dir, "state.json"), JSON.stringify(state));
    const prepare = vi.fn(() => Promise.reject(new Error("must not rediscover")));
    const extract = vi.fn(() => Promise.reject(new Error("must not reextract")));
    const upload = vi.fn(
      (copy: Record<string, unknown>, _signal: AbortSignal, catalog?: readonly string[]) => {
        expect(copy).toMatchObject({
          batch_id: "original",
          payload_digest: "unchanged",
          items: [{ item_id: "original:0", projects: ["atlas"] }],
        });
        expect(catalog).toEqual(["atlas"]);
        return Promise.reject(new Error("lost acknowledgement"));
      },
    );
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract,
      upload,
      now: () => 0,
      notify: () => {},
    });
    await runtime.recover();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8"))).toMatchObject({
      jobs: [{ batch }],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    type: "message",
    id: String(i),
    message: { role: i === 0 ? "user" : "assistant", content: `fact ${i}` },
  }));

test("pre-compaction awaits durable persistence but not extraction or upload, sharing settled-turn recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-before-compact-"));
  let persist!: () => void,
    extracted!: () => void,
    finishExtraction!: () => void,
    finishUpload!: () => void;
  const persistence = new Promise<void>((resolve) => {
    persist = resolve;
  });
  const started = new Promise<void>((resolve) => {
    extracted = resolve;
  });
  const extraction = new Promise<void>((resolve) => {
    finishExtraction = resolve;
  });
  const uploading = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(async () => {
      extracted();
      await extraction;
      return { batch: { items: [] } };
    });
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract,
      upload: () => uploading,
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    const track = queue.track.bind(queue);
    vi.spyOn(queue, "track").mockImplementation(async (...args) => {
      await persistence;
      return track(...args);
    });
    let compacted = false;
    const compact = runtime.beforeCompact("s", entries(2)).then(() => {
      compacted = true;
    });
    await Promise.resolve();
    expect(compacted).toBe(false);
    expect(queue.jobs()).toEqual([]);
    persist();
    await compact;
    await started;
    expect(compacted).toBe(true);
    await runtime.settle("s", entries(2));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(queue.jobs().flatMap((j) => j.segment.messages.map((m) => m.entry_id))).toEqual([
      "0",
      "1",
    ]);
    expect(Object.keys(queue.jobs()[0].segment)).toEqual(["messages"]);
    finishExtraction();
    finishUpload();
    await runtime.recover();
    expect(queue.jobs()).toEqual([]);
  } finally {
    persist();
    finishExtraction();
    finishUpload();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new settled turn survives while an earlier upload is pending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-upload-race-"));
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const uploading = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract: () => Promise.resolve({ batch: { items: [] } }),
      upload: async () => {
        started();
        await pending;
      },
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(1));
    await uploading;
    await runtime.startRequest("s", entries(1));
    await runtime.settle("s", entries(2));
    const restored = await CaptureQueue.open(dir, "cos");
    expect(restored.jobs().flatMap((job) => job.segment.messages.map((m) => m.entry_id))).toEqual([
      "0",
      "1",
    ]);
    expect(restored.jobs().every((job) => Object.keys(job.segment).join() === "messages")).toBe(
      true,
    );
    release();
    await runtime.recover();
    expect(queue.jobs().flatMap((job) => job.segment.messages.map((m) => m.entry_id))).toEqual([
      "1",
    ]);
    await runtime.recover();
    expect(queue.jobs()).toEqual([]);
    runtime.shutdown();
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown prevents pre-compaction from starting or continuing another queued job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-compact-stop-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const extract = vi.fn(async (_job: CaptureJob, signal: AbortSignal) => {
      started();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
      );
      return { batch: {} };
    });
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract,
      upload: () => Promise.resolve(),
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.flush("s", entries(2));
    await runtime.startRequest("other", []);
    await runtime.flush("other", entries(2));
    await runtime.beforeCompact("s", entries(2));
    await ready;
    runtime.shutdown();
    await runtime.recover();
    await runtime.beforeCompact("other", entries(2));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(queue.jobs()).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compaction preserves sources, capture retries are frozen, and a fork does not backfill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(() => Promise.resolve({ batch: { items: [] } }));
    const upload = vi.fn(() => Promise.reject(new Error("offline")));
    let now = 0;
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract,
      upload,
      now: () => now,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.flush("s", entries(2));
    await runtime.settle("s", entries(4));
    await runtime.recover();
    expect(queue.jobs().flatMap((j) => j.segment.messages.map((m) => m.entry_id))).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(queue.jobs().every((j) => Object.keys(j.segment).join() === "messages")).toBe(true);
    expect(extract).toHaveBeenCalledTimes(2);
    now = 2000;
    await runtime.recover();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(4);
    await runtime.initialize("fork", entries(4));
    await runtime.startRequest("fork", entries(4));
    await runtime.settle("fork", entries(4));
    expect(queue.jobs()).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed pre-compaction persistence never starts recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-compact-fail-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn(() => Promise.resolve({ batch: {} }));
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract,
      upload: () => Promise.resolve(),
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    vi.spyOn(queue, "track").mockRejectedValue(new Error("disk full"));
    await expect(runtime.beforeCompact("s", entries(2))).rejects.toThrow("disk full");
    expect(extract).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog and rejected work survive restart without rediscovering or regenerating accepted entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-projects-"));
  try {
    let now = 0;
    const prepare = vi.fn(() => Promise.resolve(["Atlas", "Beacon", "global"]));
    const rejected = [
      {
        index: 1,
        item: { content: "Wrong project", projects: ["unknown"], source_entry_ids: ["0"] },
      },
    ];
    const extract = vi.fn(async (job: CaptureJob) => {
      expect((await CaptureQueue.open(dir, "cos")).jobs()[0].project_catalog).toEqual([
        "Atlas",
        "Beacon",
        "global",
      ]);
      if (!job.projectAttempts)
        return { batch: { batch_id: "accepted", items: ["Atlas"] }, project_rejections: rejected };
      expect(job.project_rejections).toEqual(rejected);
      return { batch: { batch_id: "corrected", items: ["Beacon"] }, project_rejections: [] };
    });
    const uploaded: string[] = [];
    const worker = {
      prepare,
      extract,
      upload: (batch: Record<string, unknown>) => {
        uploaded.push(String(batch.batch_id));
        return Promise.resolve();
      },
      now: () => now,
      notify: () => {},
    };
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, worker);
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(2));
    await runtime.recover();
    expect(uploaded).toEqual(["accepted"]);
    expect(queue.jobs()[0].project_rejections).toEqual(rejected);
    now = 2000;
    const resumed = new CaptureRuntime(await CaptureQueue.open(dir, "cos"), worker);
    await resumed.recover();
    expect(uploaded).toEqual(["accepted", "corrected"]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(resumed.hasPendingCapture()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog failure retains source messages and never starts extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-catalog-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const extract = vi.fn();
    const runtime = new CaptureRuntime(queue, {
      prepare: () => Promise.reject(new Error("offline")),
      extract,
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.settle("s", entries(2));
    await runtime.recover();
    expect(extract).not.toHaveBeenCalled();
    expect(queue.jobs()[0].segment.messages.map((m) => m.entry_id)).toEqual(["0", "1"]);
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
      prepare,
      extract,
      upload: () => Promise.reject(Object.assign(new Error("long"), { rephrase: true })),
      now: () => now,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
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

test("mail remains attributed while internal runs are excluded and sessions keep their sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runtime-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      prepare,
      extract: () => Promise.reject(new Error("offline")),
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", []);
    await runtime.startRequest("other", []);
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
    expect(queue.jobs().map((j) => j.session_id)).toEqual(["s", "other"]);
    expect(queue.jobs()[0].segment.messages[0]).toMatchObject({
      speaker: "agent",
      original_mail: { sender: "manager" },
    });
    await runtime.startRequest("internal", [], { capture: false });
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
      prepare,
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
    await runtime.startRequest("s", []);
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
