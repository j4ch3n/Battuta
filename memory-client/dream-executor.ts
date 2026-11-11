import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { clientConfig } from "./config.ts";
import { DreamModelError, dreamCompletion } from "./dream-model.ts";
import { runDream } from "./dream-runtime.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { loadProjectCatalog } from "./projects.ts";
import { abortable } from "./abortable.ts";
import type { DreamOutcome } from "./dream-result.ts";

export type DreamFailure = "unavailable" | "cancelled" | "timed_out" | "failed";

export class DreamExecutionError extends Error {
  constructor(readonly failure: DreamFailure) {
    super(failure);
  }
}

export async function executeDream(
  ctx: ExtensionContext,
  options: {
    model: string;
    shutdown: AbortSignal;
    signal?: AbortSignal;
    onUsage: (usage: unknown) => Promise<void>;
  },
): Promise<DreamOutcome> {
  if (!/^[^/\s]+\/[^\s]+$/.test(options.model)) throw new DreamExecutionError("unavailable");
  const separator = options.model.indexOf("/");
  const model = ctx.modelRegistry.find(
    options.model.slice(0, separator),
    options.model.slice(separator + 1),
  );
  if (!model || `${model.provider}/${model.id}` !== options.model)
    throw new DreamExecutionError("unavailable");
  const timeout = AbortSignal.timeout(600000);
  const signal = AbortSignal.any([
    options.shutdown,
    ...(options.signal ? [options.signal] : []),
    timeout,
  ]);
  let stage = "setup";
  try {
    signal.throwIfAborted();
    const config = clientConfig();
    const prepareProjects = (signal: AbortSignal) => loadProjectCatalog(signal);
    const client = new MemoryMcpClient(config.url, prepareProjects);
    // Fixed model completions receive evidence, not CoS history or tool access.
    // The engine returns a separate public summary, never the private reflection.
    return await abortable(
      runDream(
        {
          directory: config.dataDirectory,
          now: () => new Date(),
          onStage: (value) => {
            stage = value;
          },
          complete: dreamCompletion(ctx, options.onUsage, model),
          prepareProjects,
          call: (name, args, abort, catalog) =>
            abortable(client.call(name, args, abort, catalog), abort),
        },
        signal,
      ),
      signal,
    );
  } catch (error) {
    if (error instanceof DreamExecutionError) throw error;
    const failure =
      options.shutdown.aborted || options.signal?.aborted
        ? "cancelled"
        : timeout.aborted
          ? "timed_out"
          : "failed";
    const known = [
      "Dream model did not finish",
      "Dream reflection invalid after two attempts",
      "Dream reflection evidence exceeds budget",
      "Dream already running",
      "Dream memory operation unavailable or conflicting",
      "Dream log run conflict",
    ];
    const reason =
      error instanceof ZodError
        ? "validation_error"
        : error instanceof Error && known.includes(error.message)
          ? error.message
          : "unexpected_error";
    try {
      const directory = clientConfig().dataDirectory;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = await open(join(directory, "dream-errors.jsonl"), "a", 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            stage,
            failure,
            reason,
            ...(error instanceof DreamModelError
              ? { stopReason: error.stopReason, modelErrorCategory: error.category }
              : {}),
          }) + "\n",
        );
      } finally {
        await file.close();
      }
    } catch {
      console.error("Could not write private dream diagnostics");
    }
    throw new DreamExecutionError(failure);
  }
}
