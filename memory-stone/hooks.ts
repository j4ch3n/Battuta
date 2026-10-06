import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig, type MemoryConfig } from "./config.ts";
import type { MemoryRuntime } from "./lifecycle.ts";
import type { SessionEntry } from "./stone.ts";
import type { OwnerProfile } from "./profile/storage.ts";

export function registerHooks(
  pi: ExtensionAPI,
  runtime: MemoryRuntime,
  config: MemoryConfig,
  agentDirectory?: string,
  profile?: OwnerProfile,
) {
  const ownerProfile = config.ownerProfile;
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await runtime.start(sessionId, ctx.sessionManager.getBranch() as unknown as SessionEntry[]);
    for (const warning of runtime.recoveryWarnings()) ctx.ui.notify(warning, "warning");
    Object.assign(config, await readConfig(agentDirectory), { ownerProfile });
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
    const sections = event.systemPromptOptions.sections;
    sections.battuta_memory = `${notice}${recalled ? `\n\n${recalled}` : ""}`;
    delete sections.battuta_owner_profile;
    if (profile && config.ownerProfile) {
      try {
        const current = await profile.read();
        if (current.exists) sections.battuta_owner_profile = current.content;
      } catch (error) {
        ctx.ui.notify(`Owner profile loading failed: ${String(error)}`, "error");
      }
    }
  });
  pi.on("context_with_system", (event, ctx) => {
    if (!runtime.recallInvalidated(ctx.sessionManager.getSessionId())) return;
    // Pi exposes structured system patches here. Remove only our recalled
    // section, never other extensions, ME.md, or historical tool messages.
    return {
      messages: [
        ...event.messages,
        { role: "system", content: "", sections: { battuta_memory: null }, timestamp: Date.now() },
      ],
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
      ctx.ui.notify(`Memory indexing did not fully settle: ${String(error)}`, "error");
    }
  });
  pi.on("session_start", (_event, ctx) => {
    runtime.reset(ctx.sessionManager.getSessionId());
    runtime.recover();
    for (const warning of runtime.recoveryWarnings()) ctx.ui.notify(warning, "warning");
  });
  pi.on("session_shutdown", () => {
    runtime.store.close();
  });
}
