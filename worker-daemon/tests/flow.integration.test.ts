import { expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { createTaskConnection } from "../../task-delegation/auth.ts";
import { runDaemon, type DaemonOptions } from "../daemon.ts";
import { queueSubscriber } from "../main.ts";
import { createOpenCodeAdapter } from "../opencode.ts";
import { prepareWorktree } from "../worktree.ts";
import { buildPrompt } from "../prompt.ts";
import type { WorkerConfig } from "../config.ts";
import {
  initialPromptId,
  type Principal,
  type TaskRow,
} from "../../supabase/functions/_shared/task-contracts.ts";
import {
  validateReceivedMessage,
  envelope,
  validate,
  StoredMessage,
} from "../../agent-mail/schemas.ts";
import { fakeOpenCode } from "./fixtures/opencode-server.ts";
import { smokeTaskClient } from "../scripts/smoke.ts";

const url = process.env.SUPABASE_URL!;
if (
  url !== "http://127.0.0.1:55321" ||
  process.env.SUPABASE_TEST_DB_CONTAINER !== "supabase_db_battuta-check"
)
  throw new Error("Worker integration requires the isolated local Supabase runner");
const headers = {
  apikey: process.env.SUPABASE_SECRET_KEY!,
  authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}`,
  "content-type": "application/json",
};
async function admin<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Test admin ${method} ${path.split("?")[0]} failed: ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
async function nativeFlow(mode: "daemon" | "smoke") {
  const root = await mkdtemp(join(await realpath(tmpdir()), "battuta-flow-"));
  const project = `flow-${crypto.randomUUID()}`;
  const workerID = `${project}-host`;
  const users: string[] = [];
  const connections: Awaited<ReturnType<typeof createTaskConnection>>[] = [];
  const controller = new AbortController();
  const errors: unknown[] = [];
  let running: Promise<void> | undefined;
  let adapter: Awaited<ReturnType<typeof createOpenCodeAdapter>> | undefined;
  let fixture: Awaited<ReturnType<typeof fakeOpenCode>> | undefined;
  const cleanup = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  async function identity(principal: Principal) {
    const email = `${crypto.randomUUID()}@worker-test.local`,
      password = `Local-${crypto.randomUUID()}!`;
    const user = await admin<{ id: string }>("/auth/v1/admin/users", "POST", {
      email,
      password,
      email_confirm: true,
      app_metadata: { battuta: principal },
    });
    users.push(user.id);
    const connection = await createTaskConnection({
      url,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
      email,
      password,
    });
    connections.push(connection);
    return connection;
  }
  try {
    const pm = await identity({ role: "pm", projects: [project] });
    const worker = await identity({ role: "worker", worker_id: workerID, projects: [project] });
    const checkout = join(root, "checkout");
    execFileSync("git", ["init", "-b", "main", checkout]);
    execFileSync("git", [
      "-C",
      checkout,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const config: WorkerConfig = {
      workerId: workerID,
      projects: { [project]: { checkout, baseRef: "HEAD" } },
      worktreeRoot: join(root, "trees"),
      lockPath: join(root, "lock"),
      capacity: 1,
      reconcileMs: 1000,
      model: { providerID: "fake", modelID: "fake" },
    };
    const report = {
      schema_version: 1 as const,
      state: "completed" as const,
      summary: "Bounded fixture work complete",
      checks: [
        {
          criterion_id: "c1",
          result: "passed" as const,
          evidence: [{ locator: "tests:fixture", description: "Controlled output" }],
        },
      ],
      artifacts: [],
      failure: null,
    };
    const serviceFile = join(root, "service.json");
    fixture = await fakeOpenCode(serviceFile, report);
    const registration = await readFile(serviceFile, "utf8");
    adapter = await createOpenCodeAdapter(config, {
      service: Service,
      makeClient: OpenCode.make,
      serviceFile,
    });
    const diagnostics: string[] = [];
    const native = adapter;
    const claim = vi.spyOn(worker.client, "claim");
    const start = (client: DaemonOptions["tasks"]["client"] = worker.client) =>
      runDaemon(
        {
          config,
          tasks: { principal: worker.principal, client },
          opencode: native,
          prepareWorktree,
          subscribeQueue: queueSubscriber(worker),
          log: (kind, detail) => diagnostics.push(`${kind}: ${detail}`),
        },
        controller.signal,
      );
    if (mode === "daemon") {
      running = start();
      void running.catch(() => undefined);
    }
    const instruction = {
      schema_version: 1 as const,
      summary: "Controlled flow",
      objective: "Validate integration",
      scope: ["Fixture only"],
      constraints: ["No provider calls"],
      inputs: [],
      acceptance_criteria: [{ id: "c1", expectation: "Validated result" }],
      deliverables: ["Report"],
    };
    const finished: TaskRow[] = [];
    const unrelated: TaskRow[] = [];
    const enqueueUnrelated = async (key: string) =>
      unrelated.push(await pm.client.delegate({ key: `${project}-${key}`, project, instruction }));
    if (mode === "smoke") await enqueueUnrelated("unrelated-prior");
    for (const key of mode === "daemon" ? ["first", "next"] : ["only-smoke"]) {
      const delegated = await pm.client.delegate({
        key: `${project}-${key}`,
        project,
        ticket_id: "FIS-40",
        instruction,
      });
      expect(delegated.claimed_by).toBeNull();
      if (mode === "smoke") {
        await enqueueUnrelated("unrelated-after");
        running = start(smokeTaskClient(worker.client, delegated.id, project, workerID));
        void running.catch(() => undefined);
      }
      await expect
        .poll(
          async () =>
            (await admin<TaskRow[]>(`/rest/v1/tasks_pool?id=eq.${delegated.id}&select=*`))[0]
              ?.terminal_report,
          { timeout: 15000, message: diagnostics.join("\n") },
        )
        .toEqual(report);
      const stored = (
        await admin<TaskRow[]>(`/rest/v1/tasks_pool?id=eq.${delegated.id}&select=*`)
      )[0];
      finished.push(stored);
      expect(stored.claimed_by).toBe(workerID);
      const rows = await admin<unknown[]>(
        `/rest/v1/agent_messages?conversation_id=eq.${stored.result_message_ref!.conversation_id}&select=*`,
      );
      expect(rows).toHaveLength(1);
      const mail = validateReceivedMessage(validate(StoredMessage, rows[0]));
      expect(mail.sender).toBe(`worker.${workerID}`);
      expect(mail.recipient).toBe("pm");
      expect(mail.response_due).toBeNull();
      const content = JSON.stringify(envelope(mail).content);
      expect(content).not.toContain(stored.id);
      expect(content).not.toContain(stored.opencode_session_id!);
      expect(content).toContain("Controlled flow");
    }
    if (mode === "smoke") {
      await enqueueUnrelated("unrelated-after-completion");
      await delay(1500); // allow a normal reconciliation pass after completion
      expect(claim).toHaveBeenCalledTimes(1);
      expect(claim.mock.calls[0]?.[2]).toBe(finished[0].id);
      const untouched = await admin<TaskRow[]>(
        `/rest/v1/tasks_pool?project=eq.${project}&claimed_by=is.null&select=*`,
      );
      expect(new Set(untouched.map((row) => row.id))).toEqual(
        new Set(unrelated.map((row) => row.id)),
      );
      expect(
        untouched.every(
          (row) =>
            row.claimed_at === null &&
            row.opencode_session_id === null &&
            row.terminal_report === null,
        ),
      ).toBe(true);
    }
    expect(await worker.client.listOwned()).toEqual({ tasks: [], next: null });
    expect(new Set(finished.map((task) => task.opencode_session_id)).size).toBe(finished.length);
    expect(
      new Set([...fixture.sessions.values()].map((session) => session.location.directory)).size,
    ).toBe(finished.length);
    for (const task of finished) {
      const session = fixture.sessions.get(task.opencode_session_id!)!;
      expect(session.metadata).toEqual({
        battuta: {
          schema_version: 1,
          task_id: task.id,
          worker_id: workerID,
          delegator_role: "pm",
        },
      });
      expect(session.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }]);
      expect(fixture.prompts.get(session.id)?.id).toBe(initialPromptId(task.id));
      expect(fixture.prompts.get(session.id)?.payload.text).toBe(buildPrompt(task));
      expect(
        fixture.requests.find((request) => request.path === `/api/session/${session.id}/prompt`)
          ?.body,
      ).toMatchObject({
        id: initialPromptId(task.id),
        delivery: "queue",
        resume: true,
        metadata: session.metadata,
      });
      expect(
        execFileSync(
          "git",
          ["-C", session.location.directory, "rev-parse", "--abbrev-ref", "HEAD"],
          { encoding: "utf8" },
        ),
      ).toMatch(/^agent\/fis-40-/);
    }
    expect(fixture.requests.filter((request) => request.method === "POST")).toHaveLength(
      finished.length * 2,
    );
    expect(await readFile(serviceFile, "utf8")).toBe(registration);
  } catch (error) {
    errors.push(error);
  } finally {
    controller.abort();
    await cleanup(async () => running);
    await cleanup(async () => adapter?.close());
    for (const connection of connections) await cleanup(() => connection.close());
    await cleanup(async () => fixture?.close());
    await cleanup(() => admin(`/rest/v1/agent_messages?sender=eq.worker.${workerID}`, "DELETE"));
    await cleanup(() => admin(`/rest/v1/tasks_pool?project=eq.${project}`, "DELETE"));
    for (const id of users) await cleanup(() => admin(`/auth/v1/admin/users/${id}`, "DELETE"));
    await cleanup(() => rm(root, { recursive: true, force: true }));
  }
  if (errors.length)
    throw new AggregateError(errors, "Controlled flow or test-owned cleanup failed");
}
it.each(["daemon", "smoke"] as const)(
  "real Auth/Edge/DB/mail and Git native HTTP flow: %s admission",
  nativeFlow,
);
