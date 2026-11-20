import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPermissionGate,
  createSessionInput,
  READONLY_DENIED_TOOLS,
  UNANSWERED_DENIAL,
} from "../claude-proxy.ts";
import type { ProxyMessage } from "../delegate-channel.ts";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

afterEach(() => {
  vi.useRealTimers();
});

type CanUseToolOptions = Parameters<CanUseTool>[2];
const opts = (extra: Partial<CanUseToolOptions> = {}) =>
  ({ signal: new AbortController().signal, toolUseID: "tool-1", ...extra }) as CanUseToolOptions;

async function take<T>(iterator: AsyncIterator<T>): Promise<T> {
  const next = await iterator.next();
  if (next.done) throw new Error("input ended");
  return next.value;
}

describe("createSessionInput", () => {
  test("the first prompt is yielded with a uuid", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    expect(first).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: "do the task" },
    });
    expect(first.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("the input stays open until every sent uuid appears in a result", async () => {
    const input = createSessionInput("do the task");
    const iterator = input.stream[Symbol.asyncIterator]();
    const first = await take(iterator);
    expect(input.send("also check the docs")).toBe(true);
    const second = await take(iterator);
    input.observeResult({ user_message_uuid: first.uuid, user_message_uuids: [first.uuid!] });
    expect(input.closed).toBe(false);
    input.observeResult({ user_message_uuids: [second.uuid!] });
    expect(input.closed).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  test("a pending request keeps the input open after the last result", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    input.setPending(1);
    input.observeResult({ user_message_uuids: [first.uuid!] });
    expect(input.closed).toBe(false);
    input.setPending(0);
    expect(input.closed).toBe(true);
  });

  test("pending requests alone never close an input with unanswered messages", async () => {
    const input = createSessionInput("do the task");
    await take(input.stream[Symbol.asyncIterator]());
    input.setPending(1);
    input.setPending(0);
    expect(input.closed).toBe(false);
  });

  test("sends after close return false", () => {
    const input = createSessionInput("do the task");
    const onClosed = vi.fn();
    input.onClosed(onClosed);
    input.close();
    expect(input.send("too late")).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  test("a result with only user_message_uuid counts", async () => {
    const input = createSessionInput("do the task");
    const first = await take(input.stream[Symbol.asyncIterator]());
    input.observeResult({ user_message_uuid: first.uuid });
    expect(input.closed).toBe(true);
  });
});

describe("createPermissionGate", () => {
  function gate(readonly: boolean, timeoutMs?: number) {
    const forwarded: ProxyMessage[] = [];
    const onPendingChange = vi.fn();
    const permissions = createPermissionGate({
      readonly,
      forward: (message) => forwarded.push(message),
      timeoutMs,
      onPendingChange,
    });
    return { permissions, forwarded, onPendingChange };
  }

  test.each(READONLY_DENIED_TOOLS.map((tool) => [tool]))(
    "a readonly run denies %s without asking the worker",
    async (tool) => {
      const { permissions, forwarded } = gate(true);
      const result = await permissions.canUseTool(tool, {}, opts());
      expect(result!.behavior).toBe("deny");
      expect(forwarded).toEqual([]);
    },
  );

  test("AskUserQuestion is forwarded as a question", () => {
    const { permissions, forwarded } = gate(true);
    const questions = [{ question: "Pick a colour", options: [] }];
    void permissions.canUseTool("AskUserQuestion", { questions }, opts());
    expect(forwarded).toEqual([
      { type: "request", id: expect.any(String) as string, kind: "question", questions },
    ]);
  });

  test("another tool is forwarded as a permission request with its blocked path", () => {
    const { permissions, forwarded } = gate(false);
    void permissions.canUseTool(
      "Bash",
      { command: "npm install" },
      opts({ blockedPath: "/opt/lib" }),
    );
    expect(forwarded).toEqual([
      {
        type: "request",
        id: expect.any(String) as string,
        kind: "permission",
        tool: "Bash",
        input: { command: "npm install" },
        path: "/opt/lib",
      },
    ]);
  });

  test("an allowing answer allows the tool call", async () => {
    const { permissions, forwarded } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "" });
    expect(await pending).toMatchObject({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  test("a refusing answer denies with the worker's text", async () => {
    const { permissions, forwarded } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "rm -rf x" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: false, text: "outside the commission" });
    expect(await pending).toEqual({ behavior: "deny", message: "outside the commission" });
  });

  test("an answer to AskUserQuestion puts the text into updatedInput.answers", async () => {
    const { permissions, forwarded } = gate(false);
    const questions = [{ question: "Pick a colour", options: [] }];
    const pending = permissions.canUseTool("AskUserQuestion", { questions }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "blue" });
    expect(await pending).toEqual({
      behavior: "allow",
      updatedInput: { questions, answers: { "Pick a colour": "blue" } },
    });
  });

  test("an unanswered request is denied with the fixed text after timeoutMs and forwards expired", async () => {
    vi.useFakeTimers();
    const { permissions, forwarded } = gate(false, 1000);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    const { id } = forwarded[0] as { id: string };
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ behavior: "deny", message: UNANSWERED_DENIAL });
    expect(forwarded[1]).toEqual({ type: "expired", id });
    expect(UNANSWERED_DENIAL).toBe(
      "no answer; continue with your best judgment and list it under open questions",
    );
  });

  test("the default limit for an unanswered request is 10 minutes", async () => {
    vi.useFakeTimers();
    const { permissions } = gate(false);
    const pending = permissions.canUseTool("Bash", { command: "ls" }, opts());
    await vi.advanceTimersByTimeAsync(599_999);
    expect(permissions.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)!.behavior).toBe("deny");
  });

  test("stop settles pending requests", async () => {
    const { permissions } = gate(false);
    const first = permissions.canUseTool("Bash", { command: "a" }, opts());
    const second = permissions.canUseTool("Bash", { command: "b" }, opts());
    permissions.denyAll("stopped by the worker");
    expect(await first).toEqual({ behavior: "deny", message: "stopped by the worker" });
    expect(await second).toEqual({ behavior: "deny", message: "stopped by the worker" });
    expect(permissions.pending).toBe(0);
  });

  test("an aborted request settles as denied", async () => {
    const { permissions } = gate(false);
    const controller = new AbortController();
    const pending = permissions.canUseTool(
      "Bash",
      { command: "a" },
      opts({ signal: controller.signal }),
    );
    controller.abort();
    expect((await pending)!.behavior).toBe("deny");
    expect(permissions.pending).toBe(0);
  });

  test("without forward every request is denied immediately", async () => {
    const permissions = createPermissionGate({ readonly: false, onPendingChange: vi.fn() });
    const result = await permissions.canUseTool("AskUserQuestion", { questions: [] }, opts());
    expect(result!.behavior).toBe("deny");
  });

  test("onPendingChange tracks the count", () => {
    const { permissions, forwarded, onPendingChange } = gate(false);
    void permissions.canUseTool("Bash", { command: "a" }, opts());
    const { id } = forwarded[0] as { id: string };
    permissions.answer({ type: "answer", id, allow: true, text: "" });
    expect(onPendingChange.mock.calls).toEqual([[1], [0]]);
  });
});
