import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreparedRecall } from "../recall-agent.ts";
import { record } from "./fixtures/record.ts";
import { CaptureQueue } from "../capture-queue.ts";

const run = vi.hoisted(() => vi.fn());
vi.mock("../recall-agent.ts", async (original) => ({
  ...(await original<typeof import("../recall-agent.ts")>()),
  runRecallAgent: run,
}));
import extension from "../index.ts";
afterEach(() => {
  vi.unstubAllEnvs();
  run.mockReset();
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "recall-hook-"));
  vi.stubEnv("AGENT_ROLE", "cos");
  vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", dir);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, ".pi"));
  await mkdir(join(dir, ".pi"));
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({ battutaMemoryCapture: { enabled: false } }),
  );
  await writeFile(join(dir, "ME.md"), "Owner profile");
  const hooks = new Map<string, (...args: unknown[]) => unknown>();
  extension({
    on: (name: string, fn: (...args: unknown[]) => unknown) => hooks.set(name, fn),
    appendEntry: () => {},
  } as unknown as ExtensionAPI);
  const ctx = {
    sessionManager: { getSessionId: () => "s", getBranch: () => [], buildContextEntries: () => [] },
    ui: { setStatus: () => {} },
  } as unknown as ExtensionContext;
  return { dir, hooks, ctx, close: () => rm(dir, { recursive: true, force: true }) };
}

test("our hook has no 3-second deadline and a switch discards late results", async () => {
  const f = await fixture();
  let finish!: (value: PreparedRecall) => void;
  run.mockImplementation(
    () =>
      new Promise<PreparedRecall>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    let settled = false;
    const pending = Promise.resolve(
      f.hooks.get("before_agent_start")!({ messageType: "user", prompt: "question" }, f.ctx),
    ).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    await f.hooks.get("session_before_switch")!({}, f.ctx);
    finish({
      status: "ready",
      context: "late evidence",
      validationEvidence: [],
      currentRefs: [],
      preparedAt: new Date().toISOString(),
    });
    expect(await pending).toBeUndefined();
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

test("expired recalled support drops only evidence, not the independent profile", async () => {
  const f = await fixture();
  const r = record();
  r.memory_metadata!.expires_at = new Date(Date.now() + 60000).toISOString();
  run.mockResolvedValue({
    status: "ready",
    context: "fresh evidence",
    validationEvidence: [r],
    currentRefs: [r.ref],
    preparedAt: new Date().toISOString(),
  });
  try {
    const result = (await f.hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "question" },
      f.ctx,
    )) as { message: { details: unknown; content: string; customType: string } };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(r.memory_metadata!.expires_at) + 1);
    const filtered = await f.hooks.get("context")!(
      { messages: [{ role: "custom", ...result.message }] },
      f.ctx,
    );
    expect(JSON.stringify(filtered)).toContain("Owner profile");
    expect(JSON.stringify(filtered)).not.toContain("fresh evidence");
    expect(JSON.stringify(filtered)).toContain("memory-context:unavailable");
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});

test("historical-only support may expire without withdrawing a current hypothesis", async () => {
  const f = await fixture();
  const support = record("b".repeat(64));
  support.memory_metadata!.expires_at = new Date(Date.now() + 60000).toISOString();
  const claim = record();
  claim.memory_metadata = {
    ...claim.memory_metadata!,
    knowledge_type: "hypothesis",
    confidence: "tentative",
    rationale: "Possible pattern",
    evidence: [
      {
        ref: support.ref,
        revision: support.revision,
        relation: "supports",
        requirement: "historical",
      },
    ],
  };
  run.mockResolvedValue({
    status: "ready",
    context: "qualified historical pattern",
    validationEvidence: [claim, support],
    currentRefs: [claim.ref],
    preparedAt: new Date().toISOString(),
  });
  try {
    const result = (await f.hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "question" },
      f.ctx,
    )) as { message: object };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(support.memory_metadata!.expires_at) + 1);
    const filtered = await f.hooks.get("context")!(
      { messages: [{ role: "custom", ...result.message }] },
      f.ctx,
    );
    expect(JSON.stringify(filtered)).toContain("qualified historical pattern");
    expect(JSON.stringify(filtered)).toContain("memory-context:ready");
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});

test.each(["missing", "oversized", "pending"])(
  "%s profile cannot leak or fail independent recall",
  async (condition) => {
    const f = await fixture();
    run.mockResolvedValue({
      status: "ready",
      context: "evidence",
      validationEvidence: [],
      currentRefs: [],
      preparedAt: new Date().toISOString(),
    });
    try {
      if (condition === "missing") await rm(join(f.dir, "ME.md"));
      if (condition === "oversized") await writeFile(join(f.dir, "ME.md"), "private ".repeat(5000));
      if (condition === "pending") {
        const queue = await CaptureQueue.open(join(f.dir, "capture-queue/cos"), "cos");
        await queue.track("earlier", [], false);
        await queue.track(
          "earlier",
          [{ id: "e", type: "message", message: { role: "user", content: "correction" } }],
          true,
        );
      }
      const result = await f.hooks.get("before_agent_start")!(
        { messageType: "user", prompt: "question" },
        f.ctx,
      );
      expect(JSON.stringify(result)).not.toContain("Owner profile from");
      expect(JSON.stringify(result)).not.toContain("private private");
      expect(JSON.stringify(result)).toContain(
        condition === "pending" ? "capture-pending" : "memory-context:ready",
      );
    } finally {
      await f.close();
    }
  },
);

test("next run reloads ME.md, redacts credentials and removes earlier packet", async () => {
  const f = await fixture();
  run.mockResolvedValue({
    status: "skipped",
    context: "",
    validationEvidence: [],
    currentRefs: [],
    preparedAt: new Date().toISOString(),
  });
  try {
    const first = (await f.hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "hello" },
      f.ctx,
    )) as { message: unknown };
    await writeFile(join(f.dir, "ME.md"), "Updated profile\npassword is hunter2");
    const next = (await f.hooks.get("before_agent_start")!(
      { messageType: "user", prompt: "hello" },
      f.ctx,
    )) as { message: unknown };
    expect(JSON.stringify(next)).toContain("Updated profile");
    expect(JSON.stringify(next)).not.toContain("hunter2");
    const filtered = (await f.hooks.get("context")!(
      {
        messages: [
          { role: "custom", ...(first.message as object) },
          { role: "custom", ...(next.message as object) },
        ],
      },
      f.ctx,
    )) as { messages: unknown[] };
    expect(filtered.messages).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test.each(["skipped", "ready", "partial", "unavailable"] as const)(
  "main profile is retained when recall is %s, without origin metadata",
  async (status) => {
    const dir = await mkdtemp(join(tmpdir(), "recall-hook-"));
    try {
      vi.stubEnv("AGENT_ROLE", "cos");
      vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", dir);
      vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, ".pi"));
      await mkdir(join(dir, ".pi"));
      await writeFile(
        join(dir, ".pi/settings.json"),
        JSON.stringify({ battutaMemoryCapture: { enabled: false } }),
      );
      await writeFile(join(dir, "ME.md"), "Owner likes concise replies.");
      const hooks = new Map<string, (...args: unknown[]) => unknown>();
      extension({
        on: (name: string, fn: (...args: unknown[]) => unknown) => hooks.set(name, fn),
        appendEntry: () => {},
      } as unknown as ExtensionAPI);
      run.mockResolvedValue({
        status,
        context: status === "skipped" ? "" : "evidence",
        validationEvidence: [],
        currentRefs: [],
        preparedAt: new Date().toISOString(),
      } satisfies PreparedRecall);
      const ctx = {
        sessionManager: {
          getSessionId: () => "s",
          getBranch: () => [],
          buildContextEntries: () => [],
        },
        ui: { setStatus: () => {} },
      } as unknown as ExtensionContext;
      const result = await hooks.get("before_agent_start")!(
        { messageType: "user", prompt: "hello" },
        ctx,
      );
      expect(JSON.stringify(result)).toContain("Owner likes concise replies.");
      expect(JSON.stringify(result)).toContain(`memory-context:${status}`);
      expect(run.mock.calls[0][0]).toEqual({ history: [], current: "hello" });
      expect(hooks.has("tool_call")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
