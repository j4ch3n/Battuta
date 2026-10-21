import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { DreamDependencies } from "../dream-runtime.ts";
import { MemoryMcpClient } from "../mcp-client.ts";
import { afterEach, expect, test, vi } from "vitest";
import extension from "../dream-extension.ts";
import { readSchedulerStore } from "../scheduler-store.ts";

const run = vi.hoisted(() =>
  vi.fn<(deps: DreamDependencies, signal: AbortSignal) => Promise<string>>(() =>
    Promise.resolve("Private reflection"),
  ),
);
vi.mock("../dream-runtime.ts", () => ({ runDream: run }));
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  run.mockReset().mockResolvedValue("Private reflection");
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function harness(role = "pm", job: Record<string, unknown> | null = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dream-extension-"));
  directories.push(dir);
  vi.stubEnv("AGENT_ROLE", role);
  vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", join(dir, "memory"));
  vi.stubEnv("PI_SCHEDULER_STATE_FILE", join(dir, "jobs.json"));
  await mkdir(join(dir, "memory"));
  await writeFile(
    join(dir, "memory/dream-config.json"),
    JSON.stringify({ version: 1, model: job?.model ?? "fake/model" }),
  );
  if (job)
    await writeFile(
      join(dir, "jobs.json"),
      JSON.stringify({
        version: 2,
        revision: 0,
        tasks: [
          {
            id: "battuta-memory-dream",
            name: "nightly-memory-dream",
            action: "prompt",
            scope: "global",
            status: "pending",
            type: "cron",
            schedule: "0 0 3 * * *",
            enabled: true,
            prompt:
              "Call memory_dream exactly once. Report only its completion status. Do not request or repeat private dream reflections.",
            ...job,
          },
        ],
      }),
    );
  const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const tools: ToolDefinition[] = [];
  const setActiveTools = vi.fn();
  const appendEntry = vi.fn();
  extension({
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
      hooks.set(event, handler),
    registerTool: (t: ToolDefinition) => tools.push(t),
    setActiveTools,
    appendEntry,
  } as unknown as ExtensionAPI);
  const status = vi.fn();
  const ctx = {
    model: { provider: "fake", id: "model" },
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === "fake" && ["model", "dream-model"].includes(id) ? { provider, id } : undefined,
      complete: () =>
        Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "Private reflection" }],
          usage: { totalTokens: 7 },
        }),
    },
    ui: { setStatus: status },
  } as unknown as ExtensionToolContext;
  return { hooks, tools, ctx, setActiveTools, appendEntry, status, dir };
}
test("TL never registers the dream tool or lifecycle", async () => {
  const h = await harness("tl");
  expect(h.tools).toEqual([]);
  expect(h.hooks.size).toBe(0);
});
test("PM tool returns status only and never changes normal active tools", async () => {
  const h = await harness();
  expect([...h.hooks.keys()]).not.toContain("agent_settled");
  const result = await h.tools[0].execute("id", {}, undefined, undefined, h.ctx);
  expect(result.content[0]).toEqual({ type: "text", text: '{"status":"complete"}' });
  expect(JSON.stringify(result)).not.toContain("Private reflection");
  expect(h.setActiveTools).not.toHaveBeenCalled();
  expect(h.status).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Private"));
});
test("PM catches up once without restricting normal tools", async () => {
  const h = await harness();
  await h.hooks.get("session_start")!({}, h.ctx);
  await h.hooks.get("session_start")!({}, h.ctx);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(h.setActiveTools).not.toHaveBeenCalled();
});
test.each(["startup", "tool"])(
  "%s uses the exact dream model without changing the conversation model",
  async (trigger) => {
    const h = await harness("pm", { model: "fake/dream-model" });
    const complete = vi.spyOn(h.ctx.modelRegistry, "complete");
    run.mockImplementationOnce((deps, signal) => deps.complete("prompt", "evidence", signal));
    if (trigger === "startup") await h.hooks.get("session_start")!({}, h.ctx);
    else await h.tools[0].execute("id", {}, undefined, undefined, h.ctx);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(h.status).toHaveBeenCalledWith("memory-dream", "Memory dream complete"),
    );
    expect(complete.mock.calls[0][0]).toMatchObject({ provider: "fake", id: "dream-model" });
    expect(h.ctx.model?.id).toBe("model");
  },
);
test("queued tool calls recheck disablement even while startup work is active", async () => {
  const h = await harness();
  let finish!: (value: string) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = h.tools[0].execute("first", {}, undefined, undefined, h.ctx);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  const path = join(h.dir, "jobs.json");
  const store = await readSchedulerStore(path);
  store.tasks[0].enabled = false;
  await writeFile(path, JSON.stringify(store));
  await expect(h.tools[0].execute("queued", {}, undefined, undefined, h.ctx)).rejects.toThrow(
    "Dream unavailable",
  );
  finish("Private reflection");
  await first;
  expect(run).toHaveBeenCalledTimes(1);
});
test("a cancelled caller does not wait for already-active startup work", async () => {
  const h = await harness();
  let finish!: (value: string) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await h.hooks.get("session_start")!({}, h.ctx);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  const abort = new AbortController();
  abort.abort();
  const pending = h.tools[0].execute("cancelled", {}, abort.signal, undefined, h.ctx);
  try {
    await expect(
      Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve("still waiting"), 50)),
      ]),
    ).rejects.toThrow("Dream unavailable");
  } finally {
    finish("Private reflection");
    await pending.catch(() => {});
  }
});
test.each([
  null,
  { enabled: false },
  { model: "fake/other" },
  { scope: "session" },
  { status: "cancelled" },
  { prompt: "Changed prompt" },
])("rejects absent, disabled, mismatched or unsafe dream configuration %j", async (job) => {
  const h = await harness("pm", job);
  await expect(h.tools[0].execute("id", {}, undefined, undefined, h.ctx)).rejects.toThrow(
    "Dream unavailable",
  );
  expect(run).not.toHaveBeenCalled();
});
test("shutdown aborts active work and outages expose no private error", async () => {
  run.mockImplementationOnce(
    (_deps: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("SECRET provider error"))),
      ),
  );
  const h = await harness();
  const result = h.tools[0].execute("id", {}, undefined, undefined, h.ctx);
  await vi.waitFor(() => expect(run).toHaveBeenCalled());
  await h.hooks.get("session_shutdown")!({}, h.ctx);
  await expect(result).rejects.toThrow("Dream unavailable or cancelled");
  expect(JSON.stringify(h.status.mock.calls)).not.toContain("SECRET");
});

test("records numeric model usage as a custom entry without reflection content", async () => {
  run.mockImplementationOnce((deps, signal) => deps.complete("prompt", "private evidence", signal));
  const h = await harness();
  await h.tools[0].execute("id", {}, undefined, undefined, h.ctx);
  expect(h.appendEntry).toHaveBeenCalledExactlyOnceWith("memory-dream-usage", {
    usage: { totalTokens: 7 },
  });
  const path = join(h.dir, "memory", "dream-usage.jsonl");
  const usageText = await readFile(path, "utf8");
  expect(JSON.parse(usageText)).toMatchObject({ usage: { totalTokens: 7 } });
  expect(usageText).not.toContain("Private reflection");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("whole-run deadline settles even when a memory transport ignores cancellation", async () => {
  const h = await harness();
  vi.spyOn(MemoryMcpClient.prototype, "call").mockImplementation(() => new Promise(() => {}));
  run.mockImplementationOnce(async (deps, signal) => {
    await deps.call("memory_inventory", {}, signal);
    return "must not complete";
  });
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const pending = h.tools[0].execute("id", {}, undefined, undefined, h.ctx);
  const rejected = expect(pending).rejects.toThrow("Dream unavailable or cancelled");
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(timeout).toHaveBeenCalledWith(600000);
  deadline.abort();
  await rejected;
});
