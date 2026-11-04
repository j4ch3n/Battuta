import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import worker from "./index.ts";
import { createClient } from "@supabase/supabase-js";
import { createAssignmentClient, blockAndInspect } from "./client.ts";
import { createNotifier } from "./notify.ts";
import type { Binding } from "./types.ts";

export const WORKER_TOOLS = [
  "codemode",
  "web_search",
  "web_fetch",
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "report_execution_result",
  "mcp__assignments__list_assignments",
  "mcp__assignments__get_assignment",
  "mcp__assignments__prepare_notes",
  "mcp__assignments__locate_notes",
  "mcp__memory__memory_recall",
  "mcp__memory__memory_list",
  "mcp__memory__memory_get",
  "mcp__memory__memory_health",
  "mcp__memory__memory_global_relationships",
];

export async function createWorkerRuntime(botDir: string) {
  const cwd = resolve(botDir),
    agentDir = join(cwd, ".pi");
  const runtime = await createAgentSessionRuntime(
    async (options) => {
      const services = await createAgentSessionServices({
        cwd: options.cwd,
        agentDir,
        resourceLoaderOptions: {
          extensionFactories: [
            (pi) =>
              worker(pi, (message) => {
                return session.sendCustomMessage(message, { triggerTurn: true });
              }),
          ],
        },
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
        tools: WORKER_TOOLS,
      });
      const session: AgentSession = result.session;
      return { ...result, services, diagnostics: services.diagnostics };
    },
    { cwd, agentDir, sessionManager: SessionManager.create(cwd, join(agentDir, "sessions")) },
  );
  let generation = 0;
  runtime.setBeforeSessionInvalidate(() => {
    generation++;
  });
  const bind = async (session: AgentSession) => {
    await session.bindExtensions({
      mode: "json",
      onError: () =>
        console.error("[assignment-worker] Extension error; inspect local diagnostics"),
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async (options) => {
          const before = generation,
            manager = session.sessionManager;
          const entry = [...manager.getEntries()]
            .reverse()
            .find((entry) => entry.type === "custom" && entry.customType === "assignment-handoff");
          try {
            return await runtime.newSession(options);
          } catch (error) {
            if (generation !== before && entry?.type === "custom") {
              const binding = entry.data as Binding;
              const supabaseUrl = process.env.SUPABASE_URL ?? "",
                secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
              const client = await createAssignmentClient({ supabaseUrl, secretKey });
              try {
                const detail = await blockAndInspect(
                  client,
                  binding,
                  "Fresh assignment runtime failed during session replacement",
                );
                const db = createClient(supabaseUrl, secretKey, {
                  auth: { persistSession: false, autoRefreshToken: false },
                });
                const notify = createNotifier({
                  client: db,
                  conversationId: manager.getSessionId(),
                  appendEntry: (kind, data) => manager.appendCustomEntry(kind, data),
                });
                await notify(detail);
              } finally {
                await client.close();
              }
            }
            throw error;
          }
        },
        switchSession: (path, options) => runtime.switchSession(path, options),
        fork: (entry, options) => runtime.fork(entry, options),
        navigateTree: (entry, options) => session.navigateTree(entry, options),
        reload: () => session.reload(),
      },
    });
  };
  runtime.setRebindSession(bind);
  try {
    await bind(runtime.session);
    return runtime;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

export async function runWorker(options: { botDir: string; signal: AbortSignal }): Promise<void> {
  if (options.signal.aborted) return;
  const runtime = await createWorkerRuntime(options.botDir);
  try {
    if (!options.signal.aborted)
      await new Promise<void>((resolve) => {
        options.signal.addEventListener("abort", () => resolve(), { once: true });
        if (options.signal.aborted) resolve();
      });
  } finally {
    await runtime.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const botDir = process.argv[2];
  if (!botDir) throw new Error("Usage: host.ts <bot-directory>");
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => controller.abort());
  await runWorker({ botDir, signal: controller.signal });
}
