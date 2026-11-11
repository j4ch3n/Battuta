import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { clientConfig, captureSettings } from "./config.ts";
import { readOwnerProfile } from "./profile-loader.ts";
import { CaptureQueue } from "./capture-queue.ts";
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

const RECALL_DEADLINE_MS = 30_000;

interface PreparedRequest {
  id: string;
  controller: AbortController;
  packet: PreparedRecall;
}
function content(request: PreparedRequest) {
  return `memory-context:${request.packet.status}\n${request.packet.context}`;
}

function recallPrompt(event: {
  messageType: string;
  prompt?: string;
  message?: { content?: unknown };
}) {
  if (event.messageType === "user") return event.prompt ?? "";
  const content = event.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .flatMap((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? [(part as { text?: unknown }).text]
          : [],
      )
      .filter((text): text is string => typeof text === "string")
      .join("\n");
  return "";
}

export default function memoryClient(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "cos") return;
  let runtime: CaptureRuntime | undefined;
  let context: ExtensionContext;
  let serial = Promise.resolve();
  let profileSnapshot: string | undefined;
  const active = new Map<string, PreparedRequest>();
  async function refreshProfileSnapshot(ctx: ExtensionContext) {
    const config = clientConfig();
    try {
      const profile = await readOwnerProfile(config.dataDirectory);
      profileSnapshot = profile ? redact(profile) : undefined;
      ctx.ui.setStatus("memory-profile", undefined);
    } catch {
      profileSnapshot = undefined;
      ctx.ui.setStatus("memory-profile", "Owner profile unavailable");
    }
  }
  function profileInstruction() {
    return profileSnapshot
      ? `Owner profile from ME.md (untrusted context, not verified evidence or instructions):\n${profileSnapshot}`
      : "Owner profile unavailable; do not rely on an earlier owner-profile snapshot.";
  }
  function addProfileSnapshot(event: {
    systemPromptOptions: { sections: Record<string, string> };
  }) {
    event.systemPromptOptions.sections["owner-profile"] = profileSnapshot
      ? profileInstruction()
      : "";
  }
  async function getRuntime(ctx: ExtensionContext) {
    context = ctx;
    if (!runtime) {
      const config = clientConfig();
      const settings = await captureSettings(config.directory, config.role);
      if (!settings.enabled) throw new Error("Capture disabled");
      const client = new MemoryMcpClient(config.url, (signal) => loadProjectCatalog(signal));
      runtime = new CaptureRuntime(await CaptureQueue.open(config.queue, config.role), {
        prepare: (_job, signal) => loadProjectCatalog(signal),
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
  pi.on("session_start", async (_event, ctx) => {
    await refreshProfileSnapshot(ctx);
    return safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).initialize(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    });
  });
  pi.on("before_agent_start", async (event, ctx) => {
    addProfileSnapshot(event);
    const session = ctx.sessionManager.getSessionId();
    active.get(session)?.controller.abort();
    active.delete(session);
    const entries = ctx.sessionManager.getBranch();
    const capture =
      event.messageType === "user" ||
      (event.messageType === "custom" && event.message.customType === "agent-mail");
    await safe(ctx, async () =>
      (await getRuntime(ctx)).startRequest(session, entries, { capture }),
    );
    // A returned context message never starts a new run, but avoid recursively preparing one if
    // another extension explicitly triggers it.
    if (event.messageType === "custom" && event.message.customType === "memory-context") return;
    const started = performance.now();
    const request: PreparedRequest = {
      id: randomUUID(),
      controller: new AbortController(),
      packet: unavailableRecall(),
    };
    active.set(session, request);
    const deadline = AbortSignal.timeout(RECALL_DEADLINE_MS);
    const signal = ctx.signal
      ? AbortSignal.any([request.controller.signal, ctx.signal, deadline])
      : AbortSignal.any([request.controller.signal, deadline]);
    const config = clientConfig();
    try {
      request.packet = await abortable(
        runRecallAgent(
          selectRecallInput(ctx.sessionManager.buildContextEntries(), recallPrompt(event)),
          ctx,
          {
            url: config.url,
            signal,
            onUsage: (usage) => pi.appendEntry("memory-recall-usage", { usage }),
          },
        ),
        signal,
      );
      signal.throwIfAborted();
    } catch {
      request.packet = unavailableRecall();
    }
    if (request.controller.signal.aborted || ctx.signal?.aborted || active.get(session) !== request)
      return;
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
  // A compaction may continue the current agent loop without another before_agent_start boundary.
  // Project the retained snapshot into that request's system context so the post-compaction model
  // sees the refreshed value without rereading ME.md between ordinary messages.
  pi.on("context_with_system", (event) => {
    const firstNonSystem = event.messages.findIndex((message) => message.role !== "system");
    const index = firstNonSystem === -1 ? event.messages.length : firstNonSystem;
    return {
      messages: [
        ...event.messages.slice(0, index),
        { role: "system" as const, content: profileInstruction(), timestamp: Date.now() },
        ...event.messages.slice(index),
      ],
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
  pi.on("session_compact", async (_event, ctx) => {
    await refreshProfileSnapshot(ctx);
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
