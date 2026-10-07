import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config.ts";
import { acquireDaemonLock } from "../lock.ts";
import { createOpenCodeAdapter } from "../opencode.ts";
import { runDaemon, verifyAuthority } from "../daemon.ts";
import { prepareWorktree } from "../worktree.ts";
import { queueSubscriber } from "../main.ts";
import { createTaskConnection } from "../../task-delegation/auth.ts";
import { validateReport } from "../../supabase/functions/_shared/task-contracts.ts";
import { validate, StoredMessage, validateReceivedMessage } from "../../agent-mail/schemas.ts";
import { isWorkerResult } from "../../agent-mail/worker-result.ts";

export function smokeSettings(env: NodeJS.ProcessEnv) {
  const required = (key: string) => {
    if (!env[key]?.trim()) throw new Error(`Explicit smoke setting required: ${key}`);
    return env[key];
  };
  if (required("BATTUTA_SMOKE_APPROVAL") !== "test-only-model-spend")
    throw new Error("Test environment and model-spend approval required");
  const budgetUSD = Number(required("BATTUTA_SMOKE_BUDGET_USD"));
  const deadlineMs = Number(env.BATTUTA_SMOKE_DEADLINE_MS ?? 120000);
  const configPath = required("BATTUTA_SMOKE_CONFIG");
  if (
    !isAbsolute(configPath) ||
    !Number.isFinite(budgetUSD) ||
    budgetUSD <= 0 ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1000 ||
    deadlineMs > 600000
  )
    throw new Error("Invalid smoke path, budget or deadline");
  return {
    budgetUSD,
    deadlineMs,
    configPath,
    project: required("BATTUTA_SMOKE_PROJECT"),
    mailKey: required("BATTUTA_SMOKE_MAIL_SECRET_KEY"),
    delegator: {
      url: required("SUPABASE_URL"),
      publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
      email: required("BATTUTA_SMOKE_DELEGATOR_EMAIL"),
      password: required("BATTUTA_SMOKE_DELEGATOR_PASSWORD"),
    },
    worker: {
      url: required("SUPABASE_URL"),
      publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
      email: required("WORKER_TASK_EMAIL"),
      password: required("WORKER_TASK_PASSWORD"),
    },
  };
}

/** Opt-in paid check. A deadline stops monitoring, not native execution or spend. */
export async function runSmoke(env: NodeJS.ProcessEnv): Promise<void> {
  const settings = smokeSettings(env);
  const config = await loadConfig(settings.configPath);
  if (
    config.capacity !== 1 ||
    !config.model ||
    Object.keys(config.projects).join() !== settings.project
  )
    throw new Error(
      "Smoke requires exactly one explicitly selected test project, model and capacity one",
    );
  const release = await acquireDaemonLock(config.lockPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.deadlineMs);
  let pm: Awaited<ReturnType<typeof createTaskConnection>> | undefined;
  let worker: Awaited<ReturnType<typeof createTaskConnection>> | undefined;
  let adapter: Awaited<ReturnType<typeof createOpenCodeAdapter>> | undefined;
  let running: Promise<void> | undefined;
  try {
    pm = await createTaskConnection(settings.delegator);
    worker = await createTaskConnection(settings.worker);
    if (pm.principal.role !== "pm" || !pm.principal.projects.includes(settings.project))
      throw new Error("Dedicated test PM authority required");
    verifyAuthority(config, worker.principal);
    adapter = await createOpenCodeAdapter(config); // discover only; never ensure/start/repair
    controller.signal.throwIfAborted();
    if ((await worker.client.listOwned()).tasks.length)
      throw new Error("Smoke worker already owns unfinished work; inspect without repair");
    controller.signal.throwIfAborted();
    const input = {
      key: `smoke-${crypto.randomUUID()}`,
      project: settings.project,
      instruction: {
        schema_version: 1 as const,
        summary: "Read-only bounded smoke",
        objective:
          "Read the root README.md and report its first heading. Do not modify files or call external services.",
        scope: ["Root README.md only"],
        constraints: [
          "No writes, network, installs, Linear, delegation or service lifecycle operations",
          `Approved spend ceiling USD ${settings.budgetUSD}; stop promptly after the read-only check`,
        ],
        inputs: [{ locator: "README.md", description: "Test repository README" }],
        acceptance_criteria: [
          { id: "heading", expectation: "Report the first README heading with evidence" },
        ],
        deliverables: ["Validated terminal report only"],
      },
    };
    await pm.client.delegate(input, controller.signal);
    controller.signal.throwIfAborted();
    running = runDaemon(
      {
        config,
        tasks: worker,
        opencode: adapter,
        prepareWorktree,
        subscribeQueue: queueSubscriber(worker),
        log: (kind) => console.error(`smoke: ${kind}`),
      },
      controller.signal,
    );
    void running.catch(() => controller.abort());
    while (!controller.signal.aborted) {
      const task = await pm.client.delegate(input, controller.signal); // identical-key read/retry, never new execution
      if (task.terminal_report) {
        validateReport(task.terminal_report, input.instruction);
        if (task.terminal_report.state !== "completed" || !task.result_message_ref)
          throw new Error("Smoke did not complete successfully");
        const response = await fetch(
          `${settings.delegator.url}/rest/v1/agent_messages?conversation_id=eq.${task.result_message_ref.conversation_id}&id=eq.${task.result_message_ref.id}&select=*`,
          {
            headers: { apikey: settings.mailKey, authorization: `Bearer ${settings.mailKey}` },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          },
        );
        if (!response.ok) throw new Error("Smoke result mail unavailable");
        const rows: unknown = await response.json();
        if (!Array.isArray(rows) || rows.length !== 1)
          throw new Error("Expected exactly one smoke result mail");
        const mail = validateReceivedMessage(validate(StoredMessage, rows[0]));
        if (
          mail.sender !== `worker.${config.workerId}` ||
          mail.recipient !== "pm" ||
          !isWorkerResult(mail.content) ||
          mail.content.state !== "completed" ||
          JSON.stringify(mail.content).includes(task.id) ||
          JSON.stringify(mail.content).includes(task.opencode_session_id!)
        )
          throw new Error("Unexpected smoke result mail");
        console.log(
          "Smoke observed validated completion and result mail; not independent acceptance.",
        );
        return;
      }
      await delay(1000, undefined, { signal: controller.signal });
    }
    throw new Error("Smoke deadline reached; preserve and inspect owned task/session/worktree");
  } finally {
    controller.abort();
    clearTimeout(timer);
    try {
      await running;
    } finally {
      try {
        await adapter?.close();
      } finally {
        try {
          await worker?.close();
        } finally {
          try {
            await pm?.close();
          } finally {
            await release();
          }
        }
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSmoke(process.env).catch(() => {
    console.error(
      "Smoke refused/failed. Check explicit test credentials, approval, config and already-running OpenCode 2.0.24. Preserve work; deadline does not stop native execution or enforce a spend cap.",
    );
    process.exitCode = 1;
  });
}
