import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig, type MemoryConfig } from "./config.ts";
import type { MemoryRuntime } from "./lifecycle.ts";
import type { SessionEntry } from "./stone.ts";

export function registerHooks(
  pi: ExtensionAPI,
  runtime: MemoryRuntime,
  config: MemoryConfig,
  agentDirectory?: string,
) {
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await runtime.start(sessionId, ctx.sessionManager.getBranch() as unknown as SessionEntry[]);
    Object.assign(config, await readConfig(agentDirectory));
    const state = runtime.status(sessionId)!;
    const binding = state.binding;
    ctx.ui.setStatus(
      "battuta-memory",
      binding ? `Memory: ${binding.name} + global` : "Memory: global only",
    );
    const notice = binding
      ? `Project memory is bound to ${binding.name} (${binding.projectId}) for this request. Project selection changes apply to the next request.`
      : `Project memory is unavailable for this request. Explicit global operations remain available. ${state.error ?? "Select a project."}`;
    let recalled = "";
    try {
      recalled = runtime.inject(sessionId, event.prompt, config);
    } catch (error) {
      ctx.ui.notify(`Memory retrieval failed: ${String(error)}`, "error");
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${notice}${recalled ? `\n\n${recalled}` : ""}`,
    };
  });
  // agent_end is an individual run boundary. Retries and mail-driven
  // pre-settlement continuations retain the same request and project binding.
  pi.on("agent_settled", (_event, ctx) => {
    try {
      runtime.finish(
        ctx.sessionManager.getSessionId(),
        ctx.sessionManager.getSessionFile(),
        ctx.sessionManager.getBranch() as unknown as SessionEntry[],
      );
    } catch (error) {
      ctx.ui.notify(
        `Memory indexing failed; no checkpoint was advanced: ${String(error)}`,
        "error",
      );
    }
  });
  pi.on("session_start", (_event, ctx) => {
    runtime.reset(ctx.sessionManager.getSessionId());
  });
  pi.on("session_shutdown", () => {
    runtime.store.close();
  });
}
