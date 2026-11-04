import { expect, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkerRuntime } from "../host.ts";
import type { AssignmentClientConfig, Detail } from "../types.ts";
import { AgentSession } from "@earendil-works/pi-coding-agent";

const scope = vi.hoisted(() => ({
  project: "",
  events: [] as { kind: string; id: string; position?: number }[],
  mailMode: "sent",
  attempts: 0,
  beforeNotify: undefined as undefined | ((detail: Detail) => Promise<void>),
}));
vi.mock("../client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.ts")>();
  return {
    ...actual,
    createAssignmentClient: async (config: AssignmentClientConfig) => {
      const client = await actual.createAssignmentClient(config);
      const list = client.list.bind(client),
        start = client.start.bind(client),
        finish = client.finish.bind(client);
      // Scope only test discovery; every claim/progress mutation uses the real MCP service.
      client.list = (input) => list({ ...input, project: scope.project });
      client.start = async (input) => {
        const value = await start(input);
        scope.events.push({ kind: "start", id: input.assignment_id, position: input.position });
        return value;
      };
      client.finish = async (input) => {
        const value = await finish(input);
        scope.events.push({ kind: "done", id: input.assignment_id });
        return value;
      };
      return client;
    },
  };
});
vi.mock("../notify.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notify.ts")>();
  return {
    ...actual,
    createNotifier: (options: Parameters<typeof actual.createNotifier>[0]) => {
      const notify = actual.createNotifier(options);
      return async (detail: Detail) => {
        await scope.beforeNotify?.(detail);
        return notify(detail);
      };
    },
  };
});
vi.mock("../../agent-mail/transport.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-mail/transport.ts")>();
  return {
    ...actual,
    sendProgrammaticMail: async (...args: Parameters<typeof actual.sendProgrammaticMail>) => {
      scope.attempts++;
      if (scope.mailMode === "failed") throw new actual.MailSendError("Injected transport refusal");
      if (scope.mailMode === "uncertain")
        throw new actual.UncertainWriteError("Injected lost acknowledgement");
      return actual.sendProgrammaticMail(...args);
    },
  };
});

async function fixture(blockAt = 0) {
  const url = process.env.SUPABASE_URL ?? "",
    secret = process.env.SUPABASE_SECRET_KEY ?? "",
    dbUrl = process.env.SUPABASE_DB_URL ?? "";
  for (const value of [url, dbUrl])
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(value).hostname);
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const project = `worker-it-${crypto.randomUUID()}`;
  const ids = new Set<string>();
  scope.project = project;
  scope.events = [];
  scope.attempts = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await db.rpc(name, args);
    if (response.error) throw new Error(response.error.message);
    const result = response.data as Detail & { code?: string; todo?: Detail["todos"][number] };
    if (name === "assignment_create" && result.ok) ids.add(`assignment:${result.assignment.id}`);
    return result;
  };
  scope.beforeNotify = async (detail) => {
    const current = await rpc("assignment_get", {
      p_project: project,
      p_assignment_id: detail.assignment.id,
    });
    expect(current.assignment.status).toBe(detail.assignment.status);
    scope.events.push({ kind: "mail", id: detail.assignment.id });
  };
  const root = await mkdtemp(join(tmpdir(), "battuta-worker-composed-"));
  let reports = 0,
    requests = 0;
  const server = createServer((req, res) => {
    void (async () => {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const parsed = JSON.parse(body) as { messages: { role: string }[] };
      requests++;
      const isReport = parsed.messages[parsed.messages.length - 1].role !== "tool";
      if (isReport) reports++;
      const blocked = isReport && reports === blockAt;
      const report = {
        outcome: blocked ? "blocked" : "completed",
        summary: "Observed stub-provider result",
        evidence: ["stub-evidence"],
        ...(blocked ? { blocker: "Input required" } : {}),
      };
      const delta = isReport
        ? {
            tool_calls: [
              {
                index: 0,
                id: `report-${requests}`,
                type: "function",
                function: { name: "report_execution_result", arguments: JSON.stringify(report) },
              },
            ],
          }
        : { content: "Reported" };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: isReport ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    })().catch((error) => res.destroy(error as Error));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No stub endpoint");
  const runtimes: Awaited<ReturnType<typeof createWorkerRuntime>>[] = [];
  const launch = async (count: number) => {
    for (let n = 0; n < count; n++) {
      const dir = join(root, `worker-${n}`);
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
      const runtime = await createWorkerRuntime(dir);
      runtimes.push(runtime);
    }
  };
  const wake = async () => {
    await Promise.all(
      runtimes.map((runtime) =>
        runtime.session.sendUserMessage("/worker-next", { expandPromptTemplates: true }),
      ),
    );
  };
  const mail = async () => {
    return sql`select sender,recipient,content,conversation_id::text from public.agent_messages where exists (select 1 from jsonb_array_elements(content->'references') ref where ref->>'locator' = any(${[...ids]})) order by created_at`;
  };
  return {
    rpc,
    launch,
    wake,
    runtimes,
    mail,
    get reports() {
      return reports;
    },
    async close() {
      for (const runtime of runtimes) await runtime.dispose();
      await db.removeAllChannels();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await sql.begin(async (tx) => {
        await tx`delete from public.agent_messages where exists (select 1 from jsonb_array_elements(content->'references') ref where ref->>'locator' = any(${[...ids]}))`;
        await tx`delete from public.assignment_dependencies where assignment_id in (select id from public.assignments where project=${project})`;
        await tx`delete from public.todos where assignment_id in (select id from public.assignments where project=${project})`;
        await tx`delete from public.assignments where project=${project}`;
      });
      await sql.end();
      await rm(root, { recursive: true, force: true });
      scope.beforeNotify = undefined;
    },
  };
}

test.each([false, true])(
  "two actual Pi hosts respect dependencies, persist before mail, and recover blocked plans (blocked=%s)",
  async (blocked) => {
    scope.mailMode = "sent";
    const h = await fixture(blocked ? 2 : 0);
    try {
      const a = await h.rpc("assignment_create", {
        p_project: scope.project,
        p_goal: "First",
        p_initial_todos: blocked ? ["Preserve evidence", "Need input"] : ["First step"],
      });
      const b = await h.rpc("assignment_create", {
        p_project: scope.project,
        p_goal: "Dependent",
        p_initial_todos: ["Dependent step"],
        p_depends_on_assignment_ids: [a.assignment.id],
      });
      await h.launch(2);
      await h.wake();
      if (blocked) {
        await vi.waitFor(
          async () =>
            expect(
              (
                await h.rpc("assignment_get", {
                  p_project: scope.project,
                  p_assignment_id: a.assignment.id,
                })
              ).assignment.status,
            ).toBe("blocked"),
          { timeout: 15000 },
        );
        await vi.waitFor(async () => expect((await h.mail()).length).toBe(1));
        const prior = await h.rpc("assignment_get", {
          p_project: scope.project,
          p_assignment_id: a.assignment.id,
        });
        expect(
          scope.events.some((event) => event.kind === "start" && event.id === b.assignment.id),
        ).toBe(false);
        await h.rpc("assignment_update_todo", {
          p_project: scope.project,
          p_assignment_id: a.assignment.id,
          p_position: 2,
          p_expected_updated_at: prior.todos[1].updated_at,
          p_status: "cancelled",
        });
        await h.rpc("assignment_append_todos", {
          p_project: scope.project,
          p_assignment_id: a.assignment.id,
          p_descriptions: ["Replacement"],
        });
        await h.rpc("assignment_reactivate", {
          p_project: scope.project,
          p_assignment_id: a.assignment.id,
        });
        expect(
          (
            await h.rpc("assignment_finish", {
              p_project: scope.project,
              p_assignment_id: a.assignment.id,
              p_claimed_at: prior.assignment.claimed_at,
            })
          ).code,
        ).toBe("stale_claim");
        await h.wake();
        const retained = await h.rpc("assignment_get", {
          p_project: scope.project,
          p_assignment_id: a.assignment.id,
        });
        expect(retained.todos[0].evidence).toEqual(["stub-evidence"]);
      }
      await vi.waitFor(
        async () => {
          await h.wake();
          expect(
            (
              await h.rpc("assignment_get", {
                p_project: scope.project,
                p_assignment_id: b.assignment.id,
              })
            ).assignment.status,
          ).toBe("done");
        },
        { timeout: 15000 },
      );
      await vi.waitFor(async () => expect((await h.mail()).length).toBe(blocked ? 3 : 2));
      const starts = scope.events.filter((event) => event.kind === "start");
      expect(starts.filter((event) => event.id === a.assignment.id)).toHaveLength(blocked ? 3 : 1);
      expect(starts.filter((event) => event.id === b.assignment.id)).toHaveLength(1);
      expect(
        scope.events.findIndex((event) => event.kind === "start" && event.id === b.assignment.id),
      ).toBeGreaterThan(
        scope.events.findIndex((event) => event.kind === "done" && event.id === a.assignment.id),
      );
      for (const message of await h.mail()) {
        expect(message.sender).toBe("worker");
        expect(message.recipient).toBe("manager");
      }
      expect(h.reports).toBe(blocked ? 4 : 2);
      expect(
        (
          await h.rpc("assignment_get", {
            p_project: scope.project,
            p_assignment_id: a.assignment.id,
          })
        ).assignment.status,
      ).toBe("done");
    } finally {
      await h.close();
    }
  },
);

test.each(["failed", "uncertain"])(
  "composed %s mail leaves execution done and never retries",
  async (mode) => {
    scope.mailMode = mode;
    const h = await fixture();
    try {
      const created = await h.rpc("assignment_create", {
        p_project: scope.project,
        p_goal: "Mail failure",
        p_initial_todos: ["Step"],
      });
      await h.launch(1);
      await h.wake();
      await vi.waitFor(
        async () =>
          expect(
            (
              await h.rpc("assignment_get", {
                p_project: scope.project,
                p_assignment_id: created.assignment.id,
              })
            ).assignment.status,
          ).toBe("done"),
        { timeout: 15000 },
      );
      await vi.waitFor(() => expect(scope.attempts).toBe(1));
      await vi.waitFor(() =>
        expect(
          h.runtimes[0].session.sessionManager
            .getEntries()
            .some(
              (entry) =>
                entry.type === "custom" &&
                entry.customType === "assignment-mail" &&
                (entry.data as { state?: string }).state === mode,
            ),
        ).toBe(true),
      );
      await h.wake();
      await h.wake();
      expect(h.reports).toBe(1);
      expect(scope.attempts).toBe(1);
      expect(await h.mail()).toHaveLength(0);
    } finally {
      await h.close();
    }
  },
);

test("actual asynchronous Pi prompt failure records a blocker and sends Manager mail", async () => {
  scope.mailMode = "sent";
  const h = await fixture();
  const send = vi
    .spyOn(AgentSession.prototype, "sendCustomMessage")
    .mockRejectedValueOnce(new Error("Injected preparation failure"));
  try {
    const created = await h.rpc("assignment_create", {
      p_project: scope.project,
      p_goal: "Runtime failure",
      p_initial_todos: ["Step"],
    });
    await h.launch(1);
    await h.wake();
    await vi.waitFor(
      async () =>
        expect(
          (
            await h.rpc("assignment_get", {
              p_project: scope.project,
              p_assignment_id: created.assignment.id,
            })
          ).assignment.status,
        ).toBe("blocked"),
      { timeout: 3000 },
    );
    await vi.waitFor(async () => expect((await h.mail()).length).toBe(1));
    expect(h.reports).toBe(0);
    expect(scope.events.filter((event) => event.kind === "start")).toHaveLength(1);
  } finally {
    send.mockRestore();
    await h.close();
  }
});
