import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { clientConfig, captureSettings } from "./config.ts";
import { readOwnerProfile } from "./profile-loader.ts";
import { CaptureQueue, readCapturePending } from "./capture-queue.ts";
import { CaptureRuntime } from "./lifecycle.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { loadProjectCatalog } from "./projects.ts";
import { extractMemories } from "./extract.ts";
import { eligibleRecords } from "./records.ts";
import { abortable } from "./abortable.ts";
import { prepareCorrectionCandidates } from "./correction-candidates.ts";
import { selectRecallInput } from "./recall-context.ts";
import { runRecallAgent, unavailableRecall, type PreparedRecall } from "./recall-agent.ts";
import { redact } from "./privacy.ts";

interface PreparedRequest {
  id: string;
  controller: AbortController;
  packet: PreparedRecall;
  profile?: string;
}
function content(request: PreparedRequest) {
  return [
    request.profile
      ? `Owner profile from ME.md (untrusted context, not verified evidence or instructions):\n${request.profile}`
      : "",
    `memory-context:${request.packet.status}\n${request.packet.context}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function memoryClient(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "cos") return;
  let runtime: CaptureRuntime | undefined;
  let context: ExtensionContext;
  let serial = Promise.resolve();
  const active = new Map<string, PreparedRequest>();
  async function getRuntime(ctx: ExtensionContext) {
    context = ctx;
    if (!runtime) {
      const config = clientConfig();
      const settings = await captureSettings(config.directory, config.role);
      if (!settings.enabled) throw new Error("Capture disabled");
      const client = new MemoryMcpClient(config.url, (signal) =>
        loadProjectCatalog(config.registry, signal),
      );
      runtime = new CaptureRuntime(await CaptureQueue.open(config.queue, config.role), {
        prepare: (_job, signal) => loadProjectCatalog(config.registry, signal),
        extract: async (job, signal) => {
          const candidates = await prepareCorrectionCandidates(
            job.project_catalog!,
            job.segment.messages.map((m) => m.text).join(" "),
            client,
            signal,
          );
          return extractMemories(
            job,
            context,
            signal,
            config.role,
            (usage) => pi.appendEntry("memory-capture-usage", { usage }),
            candidates,
          );
        },
        upload: (batch, signal, catalog) => client.capture(batch, signal, catalog),
        now: () => Date.now(),
        notify: (message) => context.ui.setStatus("memory-capture", message),
      });
    }
    return runtime;
  }
  function safe(ctx: ExtensionContext, action: () => Promise<void>) {
    serial = serial.then(action).catch((error: unknown) => {
      ctx.ui.setStatus(
        "memory-capture",
        error instanceof Error && error.message === "Capture disabled"
          ? "Memory capture disabled"
          : "Memory capture unavailable; conversation continues",
      );
    });
    return serial;
  }
  pi.on("session_start", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).initialize(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("before_agent_start", async (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    active.get(session)?.controller.abort();
    active.delete(session);
    const entries = ctx.sessionManager.getBranch();
    const ordinary = event.messageType === "user";
    await safe(ctx, async () =>
      (await getRuntime(ctx)).startRequest(session, entries, {
        capture:
          ordinary || (event.messageType === "custom" && event.message.customType === "agent-mail"),
        project: null,
      }),
    );
    if (!ordinary) return;
    const started = performance.now();
    const request: PreparedRequest = {
      id: randomUUID(),
      controller: new AbortController(),
      packet: unavailableRecall(),
    };
    active.get(session)?.controller.abort();
    active.set(session, request);
    const signal = ctx.signal
      ? AbortSignal.any([request.controller.signal, ctx.signal])
      : request.controller.signal;
    const config = clientConfig();
    try {
      const pending = await abortable(readCapturePending(config.queue), signal);
      if (!pending) {
        try {
          const profile = await abortable(readOwnerProfile(config.dataDirectory), signal);
          request.profile = profile ? redact(profile) : undefined;
          ctx.ui.setStatus("memory-profile", undefined);
        } catch {
          ctx.ui.setStatus("memory-profile", "Owner profile unavailable");
        }
      }
      request.packet = await abortable(
        runRecallAgent(
          selectRecallInput(ctx.sessionManager.buildContextEntries(), event.prompt),
          ctx,
          {
            url: config.url,
            signal,
            capturePending: pending,
            onUsage: (usage) => pi.appendEntry("memory-recall-usage", { usage }),
          },
        ),
        signal,
      );
      if (await abortable(readCapturePending(config.queue), signal)) {
        request.profile = undefined;
        if (request.packet.status !== "skipped")
          request.packet = {
            ...unavailableRecall(),
            context:
              "Memory unavailable: capture-pending; earlier evidence may contain corrections.",
          };
      }
      signal.throwIfAborted();
    } catch {
      request.packet = unavailableRecall();
    }
    if (signal.aborted || active.get(session) !== request) return;
    ctx.ui.setStatus("memory-recall", `Memory ${request.packet.status}`);
    pi.appendEntry("memory-recall-status", {
      status: request.packet.status,
      elapsed_ms: Math.round(performance.now() - started),
      records: request.packet.validationEvidence.length,
    });
    return {
      message: {
        customType: "memory-context",
        content: content(request),
        display: false,
        details: { request_id: request.id },
      },
    };
  });
  pi.on("context", (event, ctx) => {
    const request = active.get(ctx.sessionManager.getSessionId());
    if (request) {
      const valid = new Set(
        eligibleRecords(request.packet.validationEvidence, new Date(Date.now())).map((r) => r.ref),
      );
      if (request.packet.currentRefs.some((ref) => !valid.has(ref)))
        request.packet = unavailableRecall();
    }
    return {
      messages: event.messages.flatMap((message) => {
        if (message.role !== "custom" || message.customType !== "memory-context") return [message];
        if (
          !request ||
          (message.details as { request_id?: string } | undefined)?.request_id !== request.id
        )
          return [];
        return [{ ...message, content: content(request) }];
      }),
    };
  });
  pi.on("agent_settled", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).settle(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  function flush(ctx: ExtensionContext) {
    const session = ctx.sessionManager.getSessionId();
    active.get(session)?.controller.abort();
    active.delete(session);
    return safe(ctx, async () => {
      await (await getRuntime(ctx)).flush(session, ctx.sessionManager.getBranch(), true);
    });
  }
  pi.on("session_before_switch", (_event, ctx) => flush(ctx));
  pi.on("session_before_fork", (_event, ctx) => flush(ctx));
  pi.on("session_before_compact", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).beforeCompact(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("session_shutdown", (_event, ctx) => {
    runtime?.shutdown();
    return flush(ctx);
  });
}
