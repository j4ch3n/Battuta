import { expect, test, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorkerRuntime, runWorker, WORKER_TOOLS } from "../host.ts";
import { createServer } from "node:http";
import { detail } from "./fixtures.ts";
const backend = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue({ ok: true, assignments: [] }),
  close: vi.fn(),
  claim: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  record: vi.fn(),
  finish: vi.fn(),
  block: vi.fn(),
  mail: vi.fn(),
}));
vi.mock("../client.ts", () => ({ createAssignmentClient: () => Promise.resolve(backend) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    functions: { invoke: backend.mail },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeAllChannels: () => Promise.resolve(),
  }),
}));
test("native Pi discovers prepared skills and replaces sessions at identical cwd/agentDir without model calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "battuta-worker-pi-"));
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-private");
  await mkdir(join(dir, ".pi/skills"), { recursive: true });
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({
      packages: [],
      extensions: [
        resolve("node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js"),
      ],
    }),
  );
  await symlink(
    resolve("../skills-hub/execute-assignment"),
    join(dir, ".pi/skills/execute-assignment"),
  );
  const runtime = await createWorkerRuntime(dir);
  try {
    const first = runtime.session.sessionManager.getSessionId();
    expect(runtime.services.resourceLoader.getSkills().skills.map((s) => s.name)).toContain(
      "execute-assignment",
    );
    await runtime.session.sendUserMessage("/worker-next", { expandPromptTemplates: true });
    expect(backend.list).toHaveBeenCalled();
    expect(runtime.session.messages).toEqual([]);
    await runtime.newSession();
    expect(runtime.cwd).toBe(dir);
    expect(runtime.services.agentDir).toBe(join(dir, ".pi"));
    expect(runtime.session.sessionManager.getSessionId()).not.toBe(first);
    expect(runtime.services.resourceLoader.getSkills().skills.map((s) => s.name)).toContain(
      "execute-assignment",
    );
    expect(WORKER_TOOLS).not.toContain("mcp__assignments__claim_assignment");
    expect(runtime.session.getActiveToolNames()).toContain("codemode");
  } finally {
    await runtime.dispose();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real Pi executes ordered reporting-tool calls in one fresh assignment conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "battuta-worker-execution-"));
  const state = detail();
  state.todos.push({ ...state.todos[0], position: 2, description: "Second step" });
  const snapshot = () => structuredClone(state);
  backend.mail.mockImplementation(
    (_name: string, { body }: { body: { conversation_id: string; content: unknown } }) =>
      Promise.resolve({
        data: {
          data: {
            conversation_id: body.conversation_id,
            id: "123456abcdef",
            sender: "worker",
            recipient: "manager",
            message_type: "chat",
            content: body.content,
            status: "created",
            in_reply_to: null,
            response_due: null,
            created_at: "2026-11-04T12:00:00Z",
            read_at: null,
            replied_at: null,
          },
        },
        error: null,
      }),
  );
  backend.list.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      assignments: state.assignment.status === "active" ? [structuredClone(state.assignment)] : [],
    }),
  );
  backend.claim.mockImplementation(() => {
    state.assignment.status = "in_process";
    state.assignment.claimed_at = state.assignment.created_at;
    state.assignment.ready = false;
    return Promise.resolve(snapshot());
  });
  backend.get.mockImplementation(() => Promise.resolve(snapshot()));
  backend.start.mockImplementation(({ position }: { position: number }) => {
    const todo = state.todos[position - 1];
    todo.status = "in_progress";
    return Promise.resolve({
      ok: true,
      assignment: structuredClone(state.assignment),
      todo: structuredClone(todo),
    });
  });
  backend.record.mockImplementation(
    ({
      position,
      summary,
      evidence,
    }: {
      position: number;
      summary: string;
      evidence: string[];
    }) => {
      const todo = state.todos[position - 1];
      todo.status = "done";
      todo.outcome = summary;
      todo.evidence = evidence;
      return Promise.resolve({
        ok: true,
        assignment: structuredClone(state.assignment),
        todo: structuredClone(todo),
      });
    },
  );
  backend.finish.mockImplementation(() => {
    state.assignment.status = "done";
    return Promise.resolve({ ok: true, assignment: structuredClone(state.assignment) });
  });
  const requests: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const parsed = JSON.parse(body) as { messages: { role: string }[] };
      requests.push(parsed);
      const report = parsed.messages[parsed.messages.length - 1].role !== "tool";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const delta = report
        ? {
            tool_calls: [
              {
                index: 0,
                id: `report-${requests.length}`,
                type: "function",
                function: {
                  name: "report_execution_result",
                  arguments: JSON.stringify({
                    outcome: "completed",
                    summary: "Stub verification completed",
                    evidence: ["stub-proof"],
                  }),
                },
              },
            ],
          }
        : { content: "Reported" };
      res.end(
        `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: report ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    })().catch((error) => {
      res.destroy(error as Error);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing stub address");
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({
      packages: [],
      extensions: [],
      defaultProvider: "worker-stub",
      defaultModel: "stub",
      retry: { enabled: false },
    }),
  );
  await writeFile(
    join(dir, ".pi/models.json"),
    JSON.stringify({
      providers: {
        "worker-stub": {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          apiKey: "stub-only",
          models: [
            {
              id: "stub",
              name: "Stub",
              reasoning: false,
              input: ["text"],
              contextWindow: 32000,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "stub-only");
  const runtime = await createWorkerRuntime(dir);
  try {
    const initial = runtime.session.sessionManager.getSessionId();
    await runtime.session.sendUserMessage("/worker-next", { expandPromptTemplates: true });
    await vi.waitFor(() => expect(state.assignment.status).toBe("done"), { timeout: 10000 });
    await runtime.session.waitForIdle();
    expect(runtime.session.sessionManager.getSessionId()).not.toBe(initial);
    expect(state.todos.map((t) => t.status)).toEqual(["done", "done"]);
    expect(requests).toHaveLength(4);
    expect(runtime.cwd).toBe(dir);
    expect(backend.record).toHaveBeenCalledTimes(2);
    expect(backend.block).not.toHaveBeenCalled();
    const entries = runtime.session.sessionManager.getEntries();
    expect(
      entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "assignment-binding",
      ),
    ).toHaveLength(1);
    expect(
      entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "assignment-report",
      ),
    ).toHaveLength(2);
    const previous = runtime.session.sessionManager.getSessionId();
    state.assignment.id = "abcdef12";
    state.assignment.status = "active";
    state.assignment.claimed_at = null;
    state.assignment.ready = true;
    for (const todo of state.todos) {
      todo.assignment_id = state.assignment.id;
      todo.status = "todo";
      todo.outcome = "";
      todo.evidence = [];
    }
    await runtime.session.sendUserMessage("/worker-next", { expandPromptTemplates: true });
    await vi.waitFor(() => expect(state.assignment.status).toBe("done"), { timeout: 10000 });
    await runtime.session.waitForIdle();
    expect(runtime.session.sessionManager.getSessionId()).not.toBe(previous);
    expect(requests).toHaveLength(8);
    expect(
      runtime.session.sessionManager
        .getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === "assignment-report"),
    ).toHaveLength(2);
  } finally {
    await runtime.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

test("replacement failure after old session disposal still records the acquired claim's blocker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "battuta-worker-failed-handoff-"));
  const state = detail();
  backend.list.mockResolvedValue({ ok: true, assignments: [] });
  backend.claim.mockImplementation(() => {
    state.assignment.status = "in_process";
    state.assignment.claimed_at = state.assignment.created_at;
    return Promise.resolve(structuredClone(state));
  });
  backend.get.mockImplementation(() => Promise.resolve(structuredClone(state)));
  backend.block.mockImplementation(() => {
    state.assignment.status = "blocked";
    state.assignment.blocker = "Runtime replacement failed";
    return Promise.resolve({ ok: true, assignment: state.assignment });
  });
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "stub-only");
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({ packages: [], extensions: [] }));
  const runtime = await createWorkerRuntime(dir);
  vi.spyOn(runtime, "newSession").mockImplementation(async () => {
    await runtime.dispose();
    throw new Error("Injected runtime factory failure");
  });
  await runtime.session.sendUserMessage("/worker-next", { expandPromptTemplates: true });
  backend.list.mockResolvedValue({ ok: true, assignments: [state.assignment] });
  try {
    await runtime.session
      .sendUserMessage("/worker-next", { expandPromptTemplates: true })
      .catch(() => {});
    await vi.waitFor(() => expect(state.assignment.status).toBe("blocked"));
  } finally {
    await runtime.dispose();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

test("idle host remains alive until its shutdown signal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "battuta-worker-idle-"));
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({ packages: [], extensions: [] }));
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "stub-only");
  backend.list.mockResolvedValue({ ok: true, assignments: [] });
  const controller = new AbortController();
  let exited = false;
  const run = runWorker({ botDir: dir, signal: controller.signal }).then(() => {
    exited = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(exited).toBe(false);
    controller.abort();
    await run;
    expect(exited).toBe(true);
  } finally {
    controller.abort();
    await run;
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
