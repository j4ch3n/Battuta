import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abortable } from "./abortable.ts";
import type { DreamComplete } from "./dream-result.ts";

// A fixed id per purpose keeps dream calls off the provider's shared default session
// and leaves at most one idle provider session, replaced by the next call.
export const DREAM_SESSION_ID = "battuta-memory-dream";

export class DreamModelError extends Error {
  readonly stopReason: string;
  // Raw provider text may echo evidence: keep it for the private log only.
  readonly providerMessage: string;

  constructor(stopReason: string, message: string = "") {
    super("Dream model did not finish");
    this.stopReason = ["length", "error", "aborted", "toolUse"].includes(stopReason)
      ? stopReason
      : "unknown";
    this.providerMessage = message;
  }
}

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
        { signal: deadline, sessionId: DREAM_SESSION_ID },
      ),
      deadline,
    );
    await onUsage(response.usage);
    deadline.throwIfAborted();
    if (response.stopReason !== "stop")
      throw new DreamModelError(response.stopReason, response.errorMessage);
    return response.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  };
}
