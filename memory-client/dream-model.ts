import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abortable } from "./abortable.ts";
import type { DreamComplete } from "./dream-result.ts";

export function dreamCompletion(
  ctx: ExtensionContext,
  onUsage: (usage: unknown) => void | Promise<void> = () => {},
  model: ExtensionContext["model"] = ctx.model,
): DreamComplete {
  return async (systemPrompt, evidence, signal) => {
    signal.throwIfAborted();
    if (!model) throw new Error("No configured dream model");
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    const response = await abortable(
      ctx.modelRegistry.complete(
        model,
        {
          systemPrompt,
          messages: [{ role: "user", content: evidence, timestamp: Date.now() }],
        },
        { signal: deadline, maxTokens: 8192 },
      ),
      deadline,
    );
    await onUsage(response.usage);
    deadline.throwIfAborted();
    if (response.stopReason !== "stop") throw new Error("Dream model did not finish");
    return response.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  };
}
