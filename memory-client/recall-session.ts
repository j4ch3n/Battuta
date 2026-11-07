import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { clientConfig } from "./config.ts";
import { MemoryMcpClient } from "./mcp-client.ts";

export function recallMcpConfig(url: string) {
  new MemoryMcpClient(url);
  return {
    servers: [
      {
        name: "memory",
        source: "recall",
        scope: "extension" as const,
        config: {
          url,
          exposure: "hidden" as const,
          toolExposure: { memory_recall: "direct" as const, memory_get: "direct" as const },
        },
      },
    ],
    autoEnableCodemode: false,
    errors: [],
  };
}

export async function createRecallSession(
  ctx: ExtensionContext,
  options: {
    url: string;
    systemPrompt: string;
    signal: AbortSignal;
    observe?: ExtensionFactory;
  },
) {
  if (!ctx.model) throw new Error("No configured recall model");
  options.signal.throwIfAborted();
  const agentDir = clientConfig().directory;
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: false,
    signal: options.signal,
  });
  const provider = ctx.modelRegistry.getRegisteredProviderConfig(ctx.model.provider);
  const native = ctx.modelRegistry.getRegisteredNativeProvider(ctx.model.provider);
  if (native) modelRuntime.registerNativeProvider(native);
  if (provider) modelRuntime.registerProvider(ctx.model.provider, provider);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model as Model<Api>);
  if (!auth.ok) throw new Error("Recall provider unavailable");
  if (auth.apiKey) await modelRuntime.setRuntimeApiKey(ctx.model.provider, auth.apiKey);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: options.systemPrompt,
    extensionFactories: [
      createMcpExtension({ loadConfig: () => recallMcpConfig(options.url) }),
      ...(options.observe ? [options.observe] : []),
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    agentDir,
    model: ctx.model,
    thinkingLevel: ctx.thinkingLevel,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(ctx.cwd),
    tools: ["mcp__memory__memory_recall", "mcp__memory__memory_get"],
  });
  // Resolve every request through the parent's registry, including refreshed auth and custom providers.
  session.agent.streamFunction = (model, context, streamOptions) =>
    ctx.modelRegistry.streamSimple(model, context, streamOptions);
  const cancel = () => {
    void session.abort().catch(() => {});
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  const dispose = async () => {
    options.signal.removeEventListener("abort", cancel);
    try {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
      session.dispose();
    }
  };
  try {
    await session.bindExtensions({});
    options.signal.throwIfAborted();
  } catch (error) {
    await dispose();
    throw error;
  }
  return { session, dispose };
}
