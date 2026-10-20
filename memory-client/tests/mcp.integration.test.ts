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
      const queue = await CaptureQueue.open(join(directory, "queue"), "pm");
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
                    content: "The owner prefers concise café recommendations.",
                    scope: { global: true },
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
      await runtime.startRequest("session", [], null);
      await runtime.settle(
        "session",
        Array.from({ length: 6 }, (_, i) => ({
          id: `e${i}`,
          type: "message",
          message: { role: "user", content: "I prefer concise café recommendations." },
        })),
      );
      expect(queue.jobs()).toHaveLength(1);
      expect(queue.jobs()[0].batch).toBeDefined();
      await stop();
      await start();
      now = 2000;
      const restored = await CaptureQueue.open(join(directory, "queue"), "pm");
      await new CaptureRuntime(restored, worker).recover();
      expect(restored.jobs()).toEqual([]);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
