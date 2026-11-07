import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { CaptureQueue } from "../capture-queue.ts";
import { CaptureRuntime } from "../lifecycle.ts";
import { extractMemories } from "../extract.ts";
import { MemoryMcpClient } from "../mcp-client.ts";
import { memoryRecordSchema } from "../records.ts";
import { readValidatedProfile } from "../profile-loader.ts";
import { prepareRecall } from "../recall.ts";
import { runDream } from "../dream-runtime.ts";

test.skipIf(process.env.BATTUTA_MEMORY_INTEGRATION !== "1")(
  "durable JS capture survives lost acknowledgement and server restart",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "memory-http-test-"));
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    let server: ChildProcess | undefined;
    async function start() {
      server = spawn(
        resolve("../memory-service/.venv/bin/python"),
        [
          "-m",
          "battuta_memory.cli",
          "serve",
          "--port",
          String(address && typeof address !== "string" ? address.port : 0),
        ],
        {
          env: {
            ...process.env,
            BATTUTA_MEMORY_DATA_DIR: join(directory, "data"),
            BATTUTA_PROJECTS_ROOT: join(directory, "projects"),
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error(`Server startup timed out: ${output}`)),
          15000,
        );
        server!.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        server!.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Server exited: ${output}`));
        });
        server!.stderr!.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("Application startup complete")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    async function stop() {
      if (server && server.exitCode === null) {
        const done = once(server, "exit");
        server.kill("SIGTERM");
        await done;
      }
      server = undefined;
    }
    try {
      await start();
      const queue = await CaptureQueue.open(join(directory, "queue"), "cos");
      const client = new MemoryMcpClient(`http://127.0.0.1:${address.port}/mcp`);
      const complete = vi.fn(() =>
        Promise.resolve({
          stopReason: "stop",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: [
                  {
                    content: "Owner reported buying an NS2.",
                    scope: { global: true },
                    source_entry_ids: ["e0"],
                    keywords: ["NS2", "Nintendo", "Nintendo Switch 2", "gaming"],
                  },
                ],
              }),
            },
          ],
          usage: {},
        }),
      );
      const context = {
        model: { id: "test" },
        modelRegistry: { complete },
      } as unknown as ExtensionContext;
      let lostAcknowledgement = true;
      let now = 0;
      const worker = {
        extract: (job: Parameters<typeof extractMemories>[0], signal: AbortSignal) =>
          extractMemories(job, context, signal),
        upload: async (batch: Record<string, unknown>, signal: AbortSignal) => {
          await client.capture(batch, signal);
          if (lostAcknowledgement) {
            lostAcknowledgement = false;
            throw new Error("Lost acknowledgement");
          }
        },
        now: () => now,
        notify: () => {},
      };
      const runtime = new CaptureRuntime(queue, worker);
      await runtime.initialize("session", []);
      const binding = {
        request_id: "r1",
        conversation_id: "conversation",
        session_id: "session",
        project: null,
        origin: "owner" as const,
        admitted_at: "2026-11-06T10:00:00Z",
      };
      await runtime.startRequest("session", [], {capture:true,project:null});
      await runtime.settle("session", [
        {
          id: "e0",
          type: "message",
          timestamp: "2026-11-06T10:00:00Z",
          message: { role: "user", content: "I bought an NS2, the Nintendo console." },
        },
      ]);
      await runtime.recover();
      expect(queue.jobs()).toHaveLength(1);
      expect(queue.jobs()[0].batch).toBeDefined();
      await stop();
      await start();
      now = 2000;
      const restored = await CaptureQueue.open(join(directory, "queue"), "cos");
      await new CaptureRuntime(restored, worker).recover();
      expect(restored.jobs()).toEqual([]);
      expect(complete).toHaveBeenCalledTimes(1);
      const signal = AbortSignal.timeout(15000);
      const recalled = (await client.call(
        "memory_recall",
        { query: "Nintendo", selector: "global", limit: 20 },
        signal,
      )) as { records: unknown[]; branches: { lexical: string } };
      expect(recalled.branches.lexical).toBe("ready");
      const captured = memoryRecordSchema.parse(recalled.records[0]);
      expect(captured.memory_metadata).toMatchObject({
        stage: "temporal",
        confidence: "confirmed",
        keywords: ["NS2", "Nintendo", "Nintendo Switch 2", "gaming"],
      });
      const profileDirectory = join(directory, "client-state");
      await runDream(
        {
          directory: profileDirectory,
          now: () => new Date(),
          call: (name, args, abort) => client.call(name, args, abort),
          complete: (prompt, evidence) => {
            if (prompt.includes("Stage: cleanup")) {
              const input = JSON.parse(evidence) as { inputs: { ref: string }[] };
              return Promise.resolve(
                JSON.stringify({
                  facts: [],
                  dispositions: input.inputs.map((r) => ({
                    ref: r.ref,
                    disposition: "retain",
                    reason:
                      "Preserved the attributed purchase without inferring an enduring preference",
                  })),
                }),
              );
            }
            if (prompt.includes("Stage: synthesis")) return Promise.resolve('{"proposals":[]}');
            if (prompt.includes("Stage: challenge")) return Promise.resolve('{"decisions":[]}');
            return Promise.resolve(
              "I reviewed the purchase without increasing its confidence or assuming a long-term preference.",
            );
          },
        },
        signal,
      );
      const promoted = memoryRecordSchema.parse(
        await client.call("memory_get", { ref: captured.ref }, signal),
      );
      expect(promoted.ref).toBe(captured.ref);
      expect(promoted.revision).not.toBe(captured.revision);
      expect(promoted.memory_metadata).toMatchObject({ stage: "durable", confidence: "confirmed" });
      const packet = await prepareRecall(
        binding,
        "Nintendo console",
        [],
        client,
        AbortSignal.timeout(3000),
      );
      expect(packet.records.some((r) => r.ref === captured.ref)).toBe(true);
      expect(await readValidatedProfile(profileDirectory, packet.records, new Date())).toContain(
        "Owner reported buying an NS2.",
      );
      const hypothesis = (await client.call(
        "memory_remember",
        {
          content: "Owner may want console game suggestions",
          scope: promoted.scope,
          kind: "observation",
          sources: promoted.sources,
          idempotency_key: "console-interest",
          memory_metadata: {
            ...promoted.memory_metadata,
            knowledge_type: "hypothesis",
            confidence: "tentative",
            rationale: "A possible current interest, not a confirmed enduring trait",
            evidence: [
              {
                ref: promoted.ref,
                revision: promoted.revision,
                relation: "supports",
                requirement: "current",
              },
            ],
          },
        },
        signal,
      )) as { ref: string };
      complete.mockImplementation(() =>
        Promise.resolve({
          stopReason: "stop",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: [
                  {
                    content: "Owner reported returning the NS2; it is no longer owned.",
                    scope: { global: true },
                    source_entry_ids: ["returned"],
                    keywords: ["NS2", "Nintendo"],
                    correction: { ref: promoted.ref, revision: promoted.revision },
                  },
                ],
              }),
            },
          ],
          usage: {},
        }),
      );
      const correction = await extractMemories(
        {
          id: "correction",
          session_id: "session",
          attempts: 0,
          nextAttempt: 0,
          segment: {
            project: null,
            binding: { ...binding, request_id: "r2" },
            messages: [
              {
                entry_id: "returned",
                text: "I returned the NS2",
                speaker: "owner",
                mentioned_at: "2026-11-06T11:00:00Z",
              },
            ],
          },
        },
        context,
        signal,
        "cos",
        () => {},
        [promoted],
      );
      await client.capture(correction.batch, signal);
      const current = (await client.call(
        "memory_recall",
        { query: "Nintendo", selector: "global", limit: 20 },
        signal,
      )) as { records: unknown[] };
      const records = current.records.map((r) => memoryRecordSchema.parse(r));
      expect(records.some((r) => r.ref === promoted.ref || r.ref === hypothesis.ref)).toBe(false);
      expect(records.some((r) => r.content.includes("returning"))).toBe(true);
      expect(await readValidatedProfile(profileDirectory, records, new Date())).toBe("");
      const historical = (await client.call(
        "memory_get",
        { ref: promoted.ref, include_history: true },
        signal,
      )) as { history: { content: string }[] };
      expect(historical.history.map((r) => r.content)).toEqual([
        promoted.content,
        "Owner reported returning the NS2; it is no longer owned.",
      ]);
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
