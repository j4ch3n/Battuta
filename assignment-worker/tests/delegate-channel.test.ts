import { promises as fs } from "node:fs";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import {
  connectChannel,
  openChannel,
  readLines,
  type ChannelServer,
  type ProxyMessage,
} from "../delegate-channel.ts";

let server: ChannelServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function open() {
  const messages: ProxyMessage[] = [];
  const onDisconnect = vi.fn();
  server = await openChannel({ onMessage: (message) => messages.push(message), onDisconnect });
  return { server, messages, onDisconnect };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("a proxy with the expected token exchanges messages both ways", async () => {
  const { server, messages } = await open();
  server.expect("token-1");
  const client = await connectChannel(server.path, "token-1");
  const received: unknown[] = [];
  client.onMessage((message) => received.push(message));
  client.send({ type: "started", sessionId: "s-1" });
  await settle();
  expect(server.send({ type: "guide", text: "use the work folder" })).toBe(true);
  await settle();
  expect(messages).toEqual([{ type: "started", sessionId: "s-1" }]);
  expect(received).toEqual([{ type: "guide", text: "use the work folder" }]);
  client.close();
});

test("a wrong token is disconnected and its messages never reach the worker", async () => {
  const { server, messages } = await open();
  server.expect("token-1");
  const client = await connectChannel(server.path, "wrong");
  const closed = new Promise<void>((resolve) => client.onClose(resolve));
  client.send({ type: "started", sessionId: "s-1" });
  await closed;
  expect(messages).toEqual([]);
  expect(server.send({ type: "stop" })).toBe(false);
});

test("a stale proxy is rejected after expect() moves to a new token", async () => {
  const { server, messages } = await open();
  server.expect("token-1");
  const stale = await connectChannel(server.path, "token-1");
  const staleClosed = new Promise<void>((resolve) => stale.onClose(resolve));
  await settle();
  server.expect("token-2");
  await staleClosed;
  const late = await connectChannel(server.path, "token-1");
  const lateClosed = new Promise<void>((resolve) => late.onClose(resolve));
  late.send({ type: "started", sessionId: "late" });
  await lateClosed;
  expect(messages).toEqual([]);
});

test("send returns false with no authenticated proxy", async () => {
  const { server } = await open();
  expect(server.send({ type: "stop" })).toBe(false);
});

test("the socket file is mode 0600 and is removed on close", async () => {
  const { server } = await open();
  expect((await fs.stat(server.path)).mode & 0o777).toBe(0o600);
  await server.close();
  await expect(fs.stat(server.path)).rejects.toThrow();
});

test("onDisconnect fires when the proxy closes", async () => {
  const { server, onDisconnect } = await open();
  server.expect("token-1");
  const client = await connectChannel(server.path, "token-1");
  await settle();
  client.close();
  await settle();
  expect(onDisconnect).toHaveBeenCalledTimes(1);
});

test("the client sees onClose when the server closes", async () => {
  const { server } = await open();
  server.expect("token-1");
  const client = await connectChannel(server.path, "token-1");
  const closed = new Promise<void>((resolve) => client.onClose(resolve));
  await settle();
  await server.close();
  await closed;
});

test("malformed lines and a connection that never says hello are ignored", async () => {
  const { server, messages } = await open();
  server.expect("token-1");
  const raw = connect(server.path);
  await new Promise((resolve) => raw.once("connect", resolve));
  raw.write("not json\n");
  raw.write(`${JSON.stringify({ type: "started", sessionId: "x" })}\n`);
  await settle();
  expect(messages).toEqual([]);
  raw.destroy();
});

// Linux reports a peer that closes with unread data as ECONNRESET on the socket; the line reader must not
// re-throw it, or the worker or proxy process crashes.
test("a read error on the socket does not escape the line reader", () => {
  const socket = new PassThrough();
  socket.on("error", () => {});
  readLines(socket as never, () => {});
  expect(() => socket.emit("error", new Error("read ECONNRESET"))).not.toThrow();
});
