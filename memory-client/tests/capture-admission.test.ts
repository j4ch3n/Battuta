import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CaptureQueue } from "../capture-queue.ts";
import { CaptureRuntime } from "../lifecycle.ts";

test("ordinary turns capture with real attribution and no origin marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capture-admission-"));
  try {
    const queue = await CaptureQueue.open(dir, "cos");
    const runtime = new CaptureRuntime(queue, {
      prepare: () => Promise.resolve(["global"]),
      extract: () => Promise.reject(new Error("offline")),
      upload: async () => {},
      now: () => 0,
      notify: () => {},
    });
    await runtime.startRequest("s", [], { capture: true, project: null });
    await runtime.settle("s", [
      {
        id: "owner",
        type: "message",
        message: { role: "user", content: "I prefer concise replies" },
      },
    ]);
    await runtime.recover();
    expect(queue.jobs()[0].segment.messages[0]).toMatchObject({
      entry_id: "owner",
      speaker: "owner",
    });
    expect(queue.jobs()[0].segment.project).toBeNull();
    expect(queue.jobs()[0].blocked).not.toBe(true);
    runtime.shutdown();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
