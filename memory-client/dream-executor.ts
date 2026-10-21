import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clientConfig } from "./config.ts";
import { dreamCompletion } from "./dream-model.ts";
import { runDream } from "./dream-runtime.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { abortable } from "./abortable.ts";

export async function executeDream(
  ctx: ExtensionContext,
  options: {
    model: string;
    shutdown: AbortSignal;
    signal?: AbortSignal;
    onUsage: (usage: unknown) => Promise<void>;
  },
): Promise<void> {
  if (!/^[^/\s]+\/[^\s]+$/.test(options.model)) throw new Error("Invalid dream model");
  const separator = options.model.indexOf("/");
  const model = ctx.modelRegistry.find(
    options.model.slice(0, separator),
    options.model.slice(separator + 1),
  );
  if (!model || `${model.provider}/${model.id}` !== options.model)
    throw new Error("Configured dream model unavailable");
  const config = clientConfig();
  const signal = AbortSignal.any([
    options.shutdown,
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(600000),
  ]);
  signal.throwIfAborted();
  const client = new MemoryMcpClient(config.url);
  // Fixed model completions receive evidence, not PM history or tool access.
  // The private reflection is persisted by the engine, never returned to PM.
  await abortable(
    runDream(
      {
        directory: config.dataDirectory,
        now: () => new Date(),
        complete: dreamCompletion(ctx, options.onUsage, model),
        call: (name, args, abort) => abortable(client.call(name, args, abort), abort),
      },
      signal,
    ),
    signal,
  );
}
