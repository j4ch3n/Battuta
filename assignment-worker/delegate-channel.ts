import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** What the proxy of a delegated Claude run tells its worker. */
export type ProxyMessage =
  | { type: "hello"; token: string }
  | { type: "started"; sessionId: string }
  | { type: "request"; id: string; kind: "question"; questions: unknown }
  | {
      type: "request";
      id: string;
      kind: "permission";
      tool: string;
      input: Record<string, unknown>;
      path?: string;
    }
  | { type: "expired"; id: string }
  | { type: "closed" };

/** What the worker tells the proxy of its running Claude session. */
export type WorkerMessage =
  | { type: "answer"; id: string; allow: boolean; text: string }
  | { type: "guide"; text: string }
  | { type: "stop" };

export interface ChannelServer {
  path: string;
  /** Expect a proxy with this token; null rejects every connection. Drops any current connection. */
  expect(token: string | null): void;
  /** False when no authenticated proxy is connected. */
  send(message: WorkerMessage): boolean;
  close(): Promise<void>;
}

export interface ChannelClient {
  send(message: ProxyMessage): void;
  onMessage(handler: (message: WorkerMessage) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

/** Newline-delimited JSON lines from a socket; lines that are not JSON objects are dropped. */
export function readLines(socket: Socket, handler: (value: Record<string, unknown>) => void) {
  const lines = createInterface({ input: socket });
  // readline re-emits the socket's errors; the socket's own handler already closes it.
  lines.on("error", () => {});
  lines.on("line", (line) => {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value))
        handler(value as Record<string, unknown>);
    } catch {
      // A malformed line carries nothing to act on.
    }
  });
}

const write = (socket: Socket, message: object) => socket.write(`${JSON.stringify(message)}\n`);

function sameToken(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The worker's end: a Unix socket private to this worker process. Only a proxy whose first line is a `hello`
 * with the token of the current run is kept; everything else is disconnected.
 */
export async function openChannel(handlers: {
  onMessage(message: Exclude<ProxyMessage, { type: "hello" }>): void;
  onDisconnect(): void;
}): Promise<ChannelServer> {
  const path = join(
    tmpdir(),
    `battuta-delegate-${process.pid}-${randomBytes(6).toString("hex")}.sock`,
  );
  let token: string | null = null;
  let current: Socket | undefined;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    let greeted = false;
    readLines(socket, (value) => {
      if (!greeted) {
        greeted = true;
        if (value.type !== "hello" || token === null || !sameToken(token, value.token)) {
          socket.destroy();
          return;
        }
        current?.destroy();
        current = socket;
        return;
      }
      if (socket === current) handlers.onMessage(value as Exclude<ProxyMessage, { type: "hello" }>);
    });
    socket.on("close", () => {
      sockets.delete(socket);
      if (socket !== current) return;
      current = undefined;
      handlers.onDisconnect();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await fs.chmod(path, 0o600);
  return {
    path,
    expect(next) {
      token = next;
      const dropped = current;
      current = undefined;
      dropped?.destroy();
    },
    send(message) {
      if (!current) return false;
      write(current, message);
      return true;
    },
    async close() {
      token = null;
      current = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(path, { force: true });
    },
  };
}

/** The proxy's end: connects to its worker's socket and greets with the run's token. */
export async function connectChannel(path: string, token: string): Promise<ChannelClient> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.on("error", () => socket.destroy());
  write(socket, { type: "hello", token });
  return {
    send: (message) => void (socket.writable && write(socket, message)),
    onMessage: (handler) => readLines(socket, (value) => handler(value as WorkerMessage)),
    onClose: (handler) => void socket.on("close", handler),
    close: () => socket.end(),
  };
}
