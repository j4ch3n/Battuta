import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clientConfig, captureSettings } from "./config.ts";
import { readValidatedProfile } from "./profile-loader.ts";
import { resolveRequestBinding, type RequestBinding } from "./binding.ts";
import { CaptureQueue, readCapturePending } from "./capture-queue.ts";
import { CaptureRuntime } from "./lifecycle.ts";
import { MemoryMcpClient } from "./mcp-client.ts";
import { extractMemories } from "./extract.ts";
import { eligibleRecords } from "./records.ts";
import { randomUUID } from "node:crypto";
import { abortable } from "./abortable.ts";
import { prepareCorrectionCandidates, prepareRecall, type RecallPacket } from "./recall.ts";
import { boundRecentMessages, collectMessages, hasUnboundOrigin } from "./session-messages.ts";
import { prepareDelegation, type DelegationContent } from "./delegation.ts";

export default function memoryClient(pi: ExtensionAPI) {
  if (process.env.AGENT_ROLE !== "cos") return;
  let runtime: CaptureRuntime | undefined;
  let context: ExtensionContext;
  let serial = Promise.resolve();
  const active = new Map<string, { id: string; binding?: RequestBinding; packet?: RecallPacket }>();
  const controllers = new Map<string, AbortController>();
  async function getRuntime(ctx: ExtensionContext) {
    context = ctx;
    if (!runtime) {
      const config = clientConfig();
      const settings = await captureSettings(config.directory, config.role);
      if (!settings.enabled) throw new Error("Capture disabled");
      const client = new MemoryMcpClient(config.url);
      runtime = new CaptureRuntime(await CaptureQueue.open(config.queue, config.role), {
        extract: async (job, signal) => {
          const candidates = await prepareCorrectionCandidates(
            job.segment.project,
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
        upload: (batch, signal) => client.capture(batch, signal),
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
      const r = await getRuntime(ctx);
      await r.initialize(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("before_agent_start", async (event, ctx) => {
    const started = performance.now();
    const session = ctx.sessionManager.getSessionId();
    controllers.get(session)?.abort();
    const controller = new AbortController();
    controllers.set(session, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
    const request = { id: randomUUID() } as {
      id: string;
      binding?: RequestBinding;
      packet?: RecallPacket;
    };
    active.set(session, request);
    let binding: RequestBinding | undefined;
    const config = clientConfig();
    const entries = ctx.sessionManager.getBranch();
    const internal = event.messageType === "custom" && event.message.customType !== "agent-mail";
    if (internal) {
      pi.appendEntry("memory-request", {
        request_id: request.id,
        conversation_id: "internal",
        session_id: session,
        project: null,
        origin: "internal",
        admitted_at: new Date().toISOString(),
      });
      await abortable(
        safe(ctx, async () => {
          const r = await getRuntime(ctx);
          if (active.get(session) === request)
            await r.startRequest(session, entries, {capture:false,project:null}, signal);
        }),
        signal,
      ).catch(() => {});
      return;
    }
    let content =
      "memory-unavailable: request origin could not be verified. This is not an empty memory inventory.";
    try {
      const origin = [...entries]
        .reverse()
        .find(
          (e) =>
            e.type === "custom" &&
            (e.customType === "memory-request" || e.customType === "memory-request-origin"),
        );
      binding = await abortable(
        resolveRequestBinding(
          origin?.type === "custom" && origin.customType === "memory-request-origin"
            ? origin.data
            : undefined,
          config.registry,
        ),
        signal,
      );
      if (binding.session_id !== session) throw new Error("Wrong memory session");
      if (
        !internal &&
        binding.origin !== "internal" &&
        (event.messageType === "user" ? binding.origin !== "owner" : binding.origin !== "mail")
      )
        throw new Error("Memory origin type mismatch");
      signal.throwIfAborted();
      if (binding.origin === "mail" && event.messageType === "custom") {
        const mail = collectMessages([
          { id: "admission", type: "custom_message", ...event.message },
        ])[0]?.original_mail;
        if (!mail || mail.message_ref.conversation_id !== binding.conversation_id)
          throw new Error("Memory mail origin mismatch");
        binding = { ...binding, mail_ref: mail.message_ref };
      }
      request.id = binding.request_id;
      request.binding = binding;
      content =
        "memory-unavailable: preparation could not verify current evidence within its deadline.";
      pi.appendEntry("memory-request", binding);
      await abortable(
        safe(ctx, async () => {
          const r = await getRuntime(ctx);
          if (active.get(session) !== request) return;
          await r.startRequest(session, entries, {capture:true,project:binding!.project}, signal);
        }),
        signal,
      );
      if (internal || binding.origin === "internal") return;
      if (await abortable(readCapturePending(config.queue), signal)) {
        content =
          "memory-unavailable: capture-pending. Earlier evidence may contain a correction; memory and profile are suppressed until it is reconciled.";
      } else {
        const packet = await prepareRecall(
          binding,
          event.messageType === "user"
            ? event.prompt
            : typeof event.message.content === "string"
              ? event.message.content
              : JSON.stringify(event.message.content),
          boundRecentMessages(entries, binding),
          new MemoryMcpClient(config.url),
          signal,
        );
        request.packet = packet;
        const profile =
          packet.status === "unavailable"
            ? ""
            : await abortable(
                readValidatedProfile(config.dataDirectory, packet.validationEvidence, new Date()),
                signal,
              );
        signal.throwIfAborted();
        content = `memory-context:${packet.status}\n${packet.content}${profile ? `\n${profile}` : ""}`;
      }
    } catch {
      request.packet = undefined;
      if (!request.binding)
        await abortable(
          safe(ctx, async () => {
            const r = await getRuntime(ctx);
            if (active.get(session) === request)
              await r.startRequest(session, entries, {capture:false,project:null}, signal);
          }),
          signal,
        ).catch(() => {});
    }
    if (internal || binding?.origin === "internal" || active.get(session) !== request) return;
    ctx.ui.setStatus(
      "memory-recall",
      request.packet ? `Memory ${request.packet.status}` : "Memory unavailable",
    );
    pi.appendEntry("memory-recall-status", {
      status: request.packet?.status ?? "unavailable",
      elapsed_ms: Math.round(performance.now() - started),
      records: request.packet?.records.length ?? 0,
    });
    return {
      message: {
        customType: "memory-context",
        content,
        display: false,
        details: { request_id: request.id },
      },
    };
  });
  pi.on("context", (event, ctx) => {
    const request = active.get(ctx.sessionManager.getSessionId());
    const unbound =
      request?.binding && hasUnboundOrigin(ctx.sessionManager.getBranch(), request.binding);
    const valid = new Set(
      eligibleRecords(request?.packet?.validationEvidence ?? [], new Date(Date.now())).map(
        (r) => r.ref,
      ),
    );
    const expired =
      request?.packet &&
      eligibleRecords(request.packet.validationEvidence, new Date(request.packet.prepared_at)).some(
        (r) => !valid.has(r.ref),
      );
    return {
      messages: event.messages.filter(
        (message) =>
          message.role !== "custom" ||
          message.customType !== "memory-context" ||
          (!!request &&
            !expired &&
            !unbound &&
            (message.details as { request_id?: string } | undefined)?.request_id === request.id),
      ),
    };
  });
  pi.on("agent_settled", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).settle(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "send_agent_message" && event.toolName !== "reply_agent_message") return;
    const input = event.input;
    const content = input.content as DelegationContent | undefined;
    if (content?.request === null) return;
    const binding = active.get(ctx.sessionManager.getSessionId())?.binding;
    if (
      !binding ||
      binding.origin === "internal" ||
      hasUnboundOrigin(ctx.sessionManager.getBranch(), binding)
    )
      return {
        block: true,
        reason:
          "Commission requires a validated request origin; no other conversation's project can be borrowed.",
      };
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
    try {
      const config = clientConfig();
      try {
        if (await abortable(readCapturePending(config.queue), signal)) controller.abort();
      } catch {
        controller.abort();
      }
      const refs = Array.isArray(content?.references)
        ? content.references
            .filter((r) => typeof r?.locator === "string" && r.locator.startsWith("memory:"))
            .map((r) => r.locator.slice(7))
        : [];
      input.content = await prepareDelegation(
        binding,
        content!,
        refs,
        new MemoryMcpClient(config.url),
        signal,
      );
    } catch {
      return {
        block: true,
        reason:
          "Memory brief missing, stale, outside scope or too large. Select verified memory:<ref> references or declare memory-context:none-relevant; do not invent context.",
      };
    }
  });
  const flush = (ctx: ExtensionContext) =>
    safe(ctx, async () => {
      const session = ctx.sessionManager.getSessionId();
      controllers.get(session)?.abort();
      controllers.delete(session);
      active.delete(session);
      await (
        await getRuntime(ctx)
      ).flush(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch(), true);
    });
  pi.on("session_before_switch", (_event, ctx) => flush(ctx));
  pi.on("session_before_fork", (_event, ctx) => flush(ctx));
  pi.on("session_before_compact", (_event, ctx) =>
    safe(ctx, async () => {
      await (
        await getRuntime(ctx)
      ).flush(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
    }),
  );
  pi.on("session_shutdown", (_event, ctx) => {
    runtime?.shutdown();
    return flush(ctx);
  });
}
