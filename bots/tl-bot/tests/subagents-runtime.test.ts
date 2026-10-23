import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Runtime } from "../.pi/extensions/bounded-subagents/runtime.ts";
import { parseConfig } from "../.pi/extensions/bounded-subagents/policy.ts";
import boundedExtension from "../.pi/extensions/bounded-subagents/index.ts";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

let server: Server;
let root: string;
let runtime: Runtime;
let requests: Record<string, unknown>[];
let mode: "success" | "failure" | "hang" | "write" | "oversized";
let baseUrl: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "bounded-runtime-"));
  writeFileSync(join(root, "input.ts"), "original");
  requests = [];
  mode = "success";
  server = createServer((req, res) => {
    void (async () => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      if (mode === "hang") return;
      if (mode === "failure") {
        res.writeHead(401);
        res.end(
          JSON.stringify({
            error: { message: "fixture provider denied", type: "invalid_request_error" },
          }),
        );
        return;
      }
      const messages = body.messages as { role: string }[];
      const tool = mode === "write" && !messages.some((m) => m.role === "tool");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      res.write(
        chunk({
          role: "assistant",
          ...(tool
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "bounded_write",
                      arguments: JSON.stringify({ path: "input.ts", content: "changed" }),
                    },
                  },
                ],
              }
            : { content: mode === "oversized" ? "x".repeat(140000) : "fixture evidence" }),
        }),
      );
      res.write(chunk({}, tool ? "tool_calls" : "stop"));
      res.write(
        `data: ${JSON.stringify({ id: "fixture", choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    })().catch((error: unknown) =>
      res.destroy(error instanceof Error ? error : new Error(String(error))),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
afterEach(async () => {
  await runtime?.shutdown();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function setup(extra = {}) {
  runtime = new Runtime(
    parseConfig({
      root,
      inputs: ["input.ts"],
      writable: ["input.ts"],
      model: "fixture-model",
      baseUrl,
      apiKeyEnv: "BATTUTA_CHILD_API_KEY",
      ...extra,
    }),
    { BATTUTA_CHILD_API_KEY: "fixture-only", LINEAR_API_TOKEN: "must-not-inherit" },
  );
}
const task = (profile = "scout") => ({
  profile,
  objective: "Inspect the input",
  inputs: ["input.ts"],
  writable: profile === "worker" ? ["input.ts"] : [],
  scope: "input.ts only",
  evidence: "paths and observations",
});

it("uses actual pinned upstream/Pi headlessly with attributable result and exact tools", async () => {
  setup();
  const [job] = runtime.start([task()]);
  const [result] = await runtime.wait([job.id]);
  expect(result.status, JSON.stringify(result)).toBe("completed");
  expect(result.result?.status).toBe("completed");
  expect(result.result?.model).toContain("fixture-model");
  expect(JSON.stringify(result.result)).toContain("fixture evidence");
  const tools = requests[0].tools as { function: { name: string } }[];
  expect(tools.map((t) => t.function.name).sort()).toEqual(["bounded_files", "bounded_read"]);
  expect(JSON.stringify(requests)).not.toContain("must-not-inherit");
  expect(result.result?.usage?.cost).toBeNull();
  expect(result.result?.usage?.input).toBe(10);
});
it("worker changes only its private authorized snapshot", async () => {
  setup();
  mode = "write";
  const [job] = runtime.start([task("worker")]);
  const [result] = await runtime.wait([job.id]);
  expect(result.status, JSON.stringify(result)).toBe("completed");
  expect(readFileSync(join(result.workspace, "input.ts"), "utf8")).toBe("changed");
  expect(readFileSync(join(root, "input.ts"), "utf8")).toBe("original");
});
it("reports actual provider rejection as failure", async () => {
  setup();
  mode = "failure";
  const [job] = runtime.start([task("reviewer")]);
  const [result] = await runtime.wait([job.id]);
  expect(result.status).toBe("failed");
  expect(result.result?.status).not.toBe("completed");
  expect(result.result?.usage).toBeUndefined();
  expect(requests).toHaveLength(1);
});
it("admits batches atomically and enforces lifetime spawn count", async () => {
  setup({ concurrency: 2, maxSpawns: 2 });
  mode = "hang";
  expect(() => runtime.start([task(), task(), task()])).toThrow(/capacity/i);
  const jobs = runtime.start([task(), task()]);
  expect(runtime.status().length).toBe(2);
  expect(() => runtime.start([task()])).toThrow();
  jobs.forEach((job) => runtime.cancel(job.id));
  expect((await runtime.wait(jobs.map((j) => j.id))).map((j) => j.status)).toEqual([
    "cancelled",
    "cancelled",
  ]);
  expect(() => runtime.start([task()])).toThrow(/spawn/i);
});
it("kills deadline-bound work and rejects launches after shutdown", async () => {
  setup({ timeoutMs: 5000 });
  mode = "hang";
  const [job] = runtime.start([task()]);
  await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 4500 });
  expect((await runtime.wait([job.id]))[0].status).toBe("timed_out");
  await runtime.shutdown();
  expect(() => runtime.start([task()])).toThrow(/shutdown/i);
});
it("parent shutdown reaps active children", async () => {
  setup();
  mode = "hang";
  const [job] = runtime.start([task()]);
  await runtime.shutdown();
  expect(runtime.status()[0].status).toBe("cancelled");
  expect(() => process.kill(job.pid!, 0)).toThrow();
});
it("does not release capacity until cancellation has reaped the process", async () => {
  setup({ concurrency: 1 });
  mode = "hang";
  const [job] = runtime.start([task()]);
  runtime.cancel(job.id);
  expect(() => runtime.start([task()])).toThrow(/capacity/i);
  await runtime.wait([job.id]);
  expect(runtime.start([task()])).toHaveLength(1);
});
it("returns failure for oversized terminal evidence", async () => {
  setup();
  mode = "oversized";
  const [job] = runtime.start([task()]);
  expect((await runtime.wait([job.id]))[0].status).toBe("failed");
});
it("rejects per-task grants outside operator authority before admitting processes", () => {
  setup();
  expect(() => runtime.start([{ ...task(), inputs: ["other.ts"] }])).toThrow(/grant/i);
  expect(() => runtime.start([{ ...task("worker"), writable: ["other.ts"] }])).toThrow(/grant/i);
  expect(() => runtime.start([{ ...task(), writable: ["input.ts"] }])).toThrow(/read.only/i);
  expect(runtime.status()).toEqual([]);
});
it("parallel children retain attribution and receive only task-specific snapshots", async () => {
  writeFileSync(join(root, "extra.ts"), "not requested");
  setup({ inputs: ["input.ts", "extra.ts"] });
  const jobs = runtime.start([task("scout"), task("reviewer")]);
  const results = await runtime.wait(jobs.map((job) => job.id));
  expect(results.map((job) => job.profile)).toEqual(["scout", "reviewer"]);
  expect(new Set(results.map((job) => job.id)).size).toBe(2);
  for (const job of results) {
    expect(job.status).toBe("completed");
    expect(existsSync(join(job.workspace, "input.ts"))).toBe(true);
    expect(existsSync(join(job.workspace, "extra.ts"))).toBe(false);
  }
});

async function host() {
  const agentDir = join(root, ".pi");
  mkdirSync(agentDir);
  writeFileSync(
    join(agentDir, "subagents.json"),
    JSON.stringify({
      root,
      inputs: ["input.ts"],
      writable: ["input.ts"],
      model: "fixture-model",
      baseUrl,
      apiKeyEnv: "BATTUTA_CHILD_API_KEY",
    }),
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("BATTUTA_CHILD_API_KEY", "fixture-only");
  let tool!: ToolDefinition;
  const messages: unknown[] = [];
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    noExtensions: true,
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    extensionFactories: [
      {
        name: "bounded-test-host",
        factory(api) {
          boundedExtension(
            new Proxy(api, {
              get(target, property) {
                if (property === "registerTool")
                  return (value: ToolDefinition) => {
                    tool = value;
                    target.registerTool(value);
                  };
                // Stub only the external wake/message boundary; execute the real registered tool.
                if (property === "sendMessage")
                  return (value: unknown) => {
                    messages.push(value);
                  };
                return Reflect.get(target, property) as unknown;
              },
            }),
          );
        },
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    resourceLoader: loader,
    tools: ["bounded_subagents"],
    sessionManager: SessionManager.inMemory(root),
  });
  await session.bindExtensions({
    mode: "print",
    onError(error) {
      throw new Error(error.error);
    },
  });
  const invoke = async (args: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await tool.execute(
      "fixture",
      args,
      signal,
      undefined,
      session.extensionRunner.createToolContext("fixture", signal),
    );
    return JSON.parse((response.content[0] as { text: string }).text) as ReturnType<
      Runtime["status"]
    >;
  };
  return {
    session,
    invoke,
    messages,
    async close() {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    },
  };
}
it("launches foreground and background through the actual headless Pi tool", async () => {
  const parent = await host();
  try {
    expect((await parent.invoke({ action: "launch", tasks: [task()] }))[0].status).toBe(
      "completed",
    );
    const [background] = await parent.invoke({
      action: "launch",
      background: true,
      tasks: [task("reviewer")],
    });
    expect(background.status).toBe("running");
    await vi.waitFor(() => expect(parent.messages).toHaveLength(1), { timeout: 10000 });
    expect((await parent.invoke({ action: "status", ids: [background.id] }))[0].status).toBe(
      "completed",
    );
    expect(JSON.stringify(parent.messages)).toContain(background.id);
  } finally {
    await parent.close();
  }
});
it("headless Pi tool cancellation and session shutdown stop owned processes", async () => {
  const parent = await host();
  mode = "hang";
  try {
    const [job] = await parent.invoke({ action: "launch", background: true, tasks: [task()] });
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 10000 });
    expect((await parent.invoke({ action: "cancel", ids: [job.id] }))[0].status).toBe("cancelled");
    expect(() => process.kill(job.pid!, 0)).toThrow();
    const [active] = await parent.invoke({ action: "launch", background: true, tasks: [task()] });
    await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 10000 });
    await parent.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    expect(() => process.kill(active.pid!, 0)).toThrow();
  } finally {
    await parent.close();
  }
});
