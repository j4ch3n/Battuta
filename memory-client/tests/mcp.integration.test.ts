import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
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
import { runDream } from "../dream-runtime.ts";
import { loadProjectCatalog } from "../projects.ts";
import { prepareCorrectionCandidates } from "../correction-candidates.ts";

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
      const cliHome = join(directory, "cli-home");
      const cli = resolve("../project-context-cli/.venv/bin/battuta-project");
      for (const name of ["Atlas", "Beacon", "My Project", "项目"])
        await promisify(execFile)(cli, ["init", name], {
          env: { PATH: process.env.PATH, HOME: cliHome, LINEAR_API_TOKEN: "offline-test" },
        });
      vi.stubEnv("PATH", `${resolve("../project-context-cli/.venv/bin")}:${process.env.PATH}`);
      vi.stubEnv("LINEAR_API_TOKEN", "offline-test");
      vi.stubEnv("HOME", cliHome);
      expect(await loadProjectCatalog(new AbortController().signal)).toEqual([
        "Atlas",
        "Beacon",
        "My Project",
        "global",
        "项目",
      ]);
      await start();
      const queue = await CaptureQueue.open(join(directory, "queue"), "cos");
      const prepareProjects = (signal: AbortSignal) => loadProjectCatalog(signal);
      const client = new MemoryMcpClient(`http://127.0.0.1:${address.port}/mcp`, prepareProjects);
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
                    projects: ["global"],
                    source_entry_ids: ["e0"],
                    keywords: ["NS2", "Nintendo", "Nintendo Switch 2", "gaming"],
                  },
                  {
                    content: "Atlas and Beacon share PostgreSQL.",
                    projects: ["Atlas", "Beacon"],
                    source_entry_ids: ["e0"],
                  },
                  {
                    content: "My Project and 项目 use SQLite.",
                    projects: ["My Project", "项目"],
                    source_entry_ids: ["e0"],
                  },
                  {
                    content: "Atlas uses SQLite for local cache.",
                    projects: ["unknown"],
                    source_entry_ids: ["e0"],
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
        prepare: (_job: Parameters<typeof extractMemories>[0], signal: AbortSignal) =>
          loadProjectCatalog(signal),
        extract: (job: Parameters<typeof extractMemories>[0], signal: AbortSignal) =>
          extractMemories(job, context, signal),
        upload: async (
          batch: Record<string, unknown>,
          signal: AbortSignal,
          catalog?: readonly string[],
        ) => {
          await client.capture(batch, signal, catalog);
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
      await runtime.startRequest("session", [], { capture: true });
      await runtime.settle("session", [
        {
          id: "e0",
          type: "message",
          timestamp: "2026-11-06T10:00:00Z",
          message: {
            role: "user",
            content:
              "I bought an NS2, the Nintendo console. Atlas and Beacon share PostgreSQL. My Project and 项目 use SQLite. Atlas uses SQLite for local cache.",
          },
        },
      ]);
      await runtime.recover();
      expect(queue.jobs()).toHaveLength(1);
      expect(queue.jobs()[0].batch).toBeDefined();
      await stop();
      await start();
      now = 2000;
      const restored = await CaptureQueue.open(join(directory, "queue"), "cos");
      const resumed = new CaptureRuntime(restored, worker);
      await resumed.recover();
      expect(restored.jobs()).toHaveLength(1);
      expect(complete).toHaveBeenCalledTimes(1);
      complete.mockResolvedValueOnce({
        stopReason: "stop",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: [
                {
                  content: "Atlas uses SQLite for local cache.",
                  projects: ["Atlas"],
                  source_entry_ids: ["e0"],
                  retry_entry_id: 3,
                },
              ],
            }),
          },
        ],
        usage: {},
      });
      now = 5000;
      await resumed.recover();
      expect(restored.jobs()).toEqual([]);
      expect(complete).toHaveBeenCalledTimes(2);
      const signal = AbortSignal.timeout(15000);
      const inventory = (await client.call(
        "memory_inventory",
        { window_start: 0, window_end: Date.now() / 1000 },
        signal,
      )) as { records: unknown[] };
      const stored = inventory.records.map((r) => memoryRecordSchema.parse(r));
      expect(stored).toHaveLength(4);
      expect(stored.some((r) => r.projects.includes("unknown"))).toBe(false);
      expect(
        stored.find((r) => r.content === "Atlas and Beacon share PostgreSQL.")?.projects,
      ).toEqual(["atlas", "beacon"]);
      expect(stored.find((r) => r.content === "My Project and 项目 use SQLite.")?.projects).toEqual(
        ["my project", "项目"],
      );
      const candidates = await prepareCorrectionCandidates(
        ["Atlas", "Beacon", "My Project", "global", "项目"],
        "PostgreSQL",
        client,
        signal,
      );
      expect(candidates.some((r) => r.content === "Atlas and Beacon share PostgreSQL.")).toBe(true);
      const recalled = (await client.call(
        "memory_recall",
        { keywords: ["Nintendo"], selector: "global", limit: 20 },
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
          prepareProjects,
          now: () => new Date(),
          call: (name, args, abort, catalog) => client.call(name, args, abort, catalog),
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
      const packet = (await client.call(
        "memory_recall",
        { semantic_query: "Nintendo console", keywords: ["Nintendo"] },
        signal,
      )) as { records: { ref: string }[]; context: string };
      expect(packet.records.some((r) => r.ref === captured.ref)).toBe(true);
      expect(packet.context).toContain("Owner reported buying an NS2.");
      const hypothesis = (await client.call(
        "memory_remember",
        {
          content: "Owner may want console game suggestions",
          projects: promoted.projects,
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
                    projects: ["global"],
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
          project_catalog: ["global"],
          session_id: "session",
          attempts: 0,
          nextAttempt: 0,
          segment: {
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
        { keywords: ["Nintendo"], selector: "global", limit: 20 },
        signal,
      )) as { records: unknown[] };
      const records = current.records.map((r) => memoryRecordSchema.parse(r));
      expect(records.some((r) => r.ref === promoted.ref || r.ref === hypothesis.ref)).toBe(false);
      expect(records.some((r) => r.content.includes("returning"))).toBe(true);
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
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60000,
);
