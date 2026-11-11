import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abortable } from "./abortable.ts";
import type { DreamComplete } from "./dream-result.ts";

export class DreamModelError extends Error {
  readonly stopReason: string;
  readonly category: string;

  constructor(stopReason: string, message: string = "") {
    super("Dream model did not finish");
    this.stopReason = ["length", "error", "aborted", "toolUse"].includes(stopReason)
      ? stopReason
      : "unknown";
    this.category = /context.{0,30}(length|window|limit)|too many (input )?tokens/i.test(message)
      ? "context_limit"
      : /max.{0,15}(output.{0,10})?tokens|token.{0,15}(limit|maximum)/i.test(message)
        ? "token_limit"
        : /rate.limit|too many requests|\b429\b/i.test(message)
          ? "rate_limit"
          : /quota|insufficient.{0,15}(credit|balance)/i.test(message)
            ? "quota"
            : /unauthori[sz]ed|authentication|invalid.{0,10}(api.?key|token)|\b401\b|\b403\b/i.test(
                  message,
                )
              ? "authentication"
              : /timed?\s*out|timeout/i.test(message)
                ? "timeout"
                : /network|connection|fetch failed/i.test(message)
                  ? "network"
                  : /\b400\b|invalid.request|bad.request/i.test(message)
                    ? "invalid_request"
                    : message
                      ? "other"
                      : "none";
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
        { signal: deadline, maxTokens: 8192 },
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
