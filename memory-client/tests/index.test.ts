import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryMcpClient } from "../mcp-client.ts";
import { record } from "./fixtures/record.ts";
import { CaptureQueue } from "../capture-queue.ts";
import { requestContent } from "./fixtures/mail.ts";
vi.mock("../projects.ts", async (original) => ({
  ...(await original<typeof import("../projects.ts")>()),
  loadProjectCatalog: () => Promise.resolve(["atlas", "beacon", "global"]),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("extension does not register legacy profile or memory tools", () => {
  vi.stubEnv("AGENT_ROLE", "cos");
  const tools: unknown[] = [];
  const hooks: string[] = [];
  extension({
    on: (event: string) => {
      hooks.push(event);
    },
    registerTool: (tool: unknown) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI);
  expect(tools).toEqual([]);
  expect(hooks).toContain("before_agent_start");
});

test.each([
  { derived: false, enabled: false },
  { derived: true, enabled: false },
  { derived: false, enabled: true },
])(
  "admission revalidates context (derived=$derived, capture=$enabled)",
  async ({ derived, enabled }) => {
    const dir = await mkdtemp(join(tmpdir(), "memory-admission-"));
    try {
      vi.stubEnv("AGENT_ROLE", "cos");
      vi.stubEnv("PI_CODING_AGENT_DIR", dir);
      vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", join(dir, "memory"));
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({ battutaMemoryCapture: { enabled } }),
      );
      const r = record(),
        support = record("b".repeat(64));
      if (derived) {
        support.memory_metadata!.expires_at = new Date(Date.now() + 60000).toISOString();
        r.memory_metadata = {
          ...r.memory_metadata!,
          knowledge_type: "hypothesis",
          confidence: "tentative",
          rationale: "Possible pattern",
          evidence: [
            {
              ref: support.ref,
              revision: support.revision,
              relation: "supports",
              requirement: "current",
            },
          ],
        };
      }
      vi.spyOn(MemoryMcpClient.prototype, "call").mockImplementation((name, args) =>
        Promise.resolve(
          name === "memory_get" ? (args.ref === support.ref ? support : r) : { records: [r] },
        ),
      );
      const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
      const origin = {
        type: "custom",
        customType: "memory-request-origin",
        data: {
          request_id: "admitted",
          conversation_id: "owner-chat",
          session_id: "s",
          project: null,
          origin: "owner",
          admitted_at: "2026-11-06T00:00:00Z",
        },
      };
      const entries: unknown[] = [origin];
      extension({
        on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
          hooks.set(name, handler),
        appendEntry: () => {},
      } as unknown as ExtensionAPI);
      const ctx = {
        sessionManager: { getSessionId: () => "s", getBranch: () => entries },
        ui: { setStatus: () => {}, notify: () => {} },
      } as unknown as ExtensionContext;
      const result = await hooks.get("before_agent_start")!(
        { messageType: "user", prompt: "Nintendo games", systemPrompt: "unchanged" },
        ctx,
      );
      expect(result).toHaveProperty("message.customType", "memory-context");
      expect(result).toHaveProperty(
        "message.content",
        expect.stringContaining("Owner bought an NS2"),
      );
      expect(result).not.toHaveProperty("systemPrompt");
      for (const toolName of ["send_agent_message", "reply_agent_message"]) {
        const input = { content: requestContent("Propose Nintendo games") };
        input.content.references.push({ locator: `memory:${r.ref}`, note: "Selected event" });
        const blocked = await hooks.get("tool_call")!(
          { toolName, toolCallId: "codemode/1", parentToolCallId: "codemode", input },
          ctx,
        );
        expect(blocked).toBeUndefined();
        expect(input.content.context.some((c) => c.includes("Owner bought an NS2"))).toBe(true);
        expect(
          await hooks.get("tool_call")!(
            {
              toolName,
              toolCallId: "codemode/2",
              parentToolCallId: "codemode",
              input: { content: requestContent("Unbriefed commission") },
            },
            ctx,
          ),
        ).toMatchObject({ block: true });
      }
      const context = await hooks.get("context")!(
        {
          messages: [
            { role: "custom", customType: "memory-context", details: { request_id: "old" } },
            { role: "custom", customType: "memory-context", details: { request_id: "admitted" } },
          ],
        },
        ctx,
      );
      expect(context).toMatchObject({ messages: [{ details: { request_id: "admitted" } }] });
      await hooks.get("session_before_compact")!({}, ctx);
      const afterCompact = requestContent("Continue the commission");
      afterCompact.context.push("memory-context:none-relevant");
      expect(
        await hooks.get("tool_call")!(
          { toolName: "send_agent_message", input: { content: afterCompact } },
          ctx,
        ),
      ).toBeUndefined();
      entries.push({
        id: "queued-mail",
        type: "custom_message",
        customType: "agent-mail",
        content: JSON.stringify({
          message_ref: { conversation_id: "other", id: "abcdef123456" },
          sender: "manager",
          content: { summary: "Different project report" },
        }),
      });
      expect(
        await hooks.get("tool_call")!(
          { toolName: "send_agent_message", input: { content: afterCompact } },
          ctx,
        ),
      ).toMatchObject({ block: true });
      const mixed = await hooks.get("context")!(
        {
          messages: [
            {
              role: "custom",
              customType: "memory-context",
              content: "Old project context",
              details: { request_id: "admitted" },
            },
          ],
        },
        ctx,
      );
      expect(JSON.stringify(mixed)).not.toContain("Old project context");
      entries.pop();
      if (derived) {
        const clock = vi
          .spyOn(Date, "now")
          .mockReturnValue(Date.parse(support.memory_metadata!.expires_at!) + 1);
        expect(
          await hooks.get("context")!(
            {
              messages: [
                {
                  role: "custom",
                  customType: "memory-context",
                  details: { request_id: "admitted" },
                },
              ],
            },
            ctx,
          ),
        ).toEqual({ messages: [] });
        clock.mockRestore();
      }
      const queue = await CaptureQueue.open(join(dir, "memory/capture-queue/cos"), "cos");
      await queue.track("earlier", [], null, false);
      await queue.track(
        "earlier",
        [
          {
            type: "message",
            id: "correction",
            message: { role: "user", content: "I returned it" },
          },
        ],
        null,
        true,
      );
      origin.data.request_id = "pending";
      const pending = await hooks.get("before_agent_start")!(
        { messageType: "user", prompt: "Nintendo games", systemPrompt: "unchanged" },
        ctx,
      );
      expect(pending).toHaveProperty("message.content", expect.stringContaining("capture-pending"));
      expect(pending).not.toHaveProperty(
        "message.content",
        expect.stringContaining("Owner bought an NS2"),
      );
      if (enabled) {
        origin.data.origin = "mail";
        await hooks.get("before_agent_start")!(
          {
            messageType: "custom",
            message: { customType: "agent-mail", content: "Invalid envelope" },
          },
          ctx,
        );
        entries.push({
          type: "message",
          id: "unvalidated",
          message: { role: "assistant", content: "Unvalidated request response" },
        });
        await hooks.get("agent_settled")!({}, ctx);
        const saved = await CaptureQueue.open(join(dir, "memory/capture-queue/cos"), "cos");
        expect(
          saved
            .jobs()
            .flatMap((j) => j.segment.messages)
            .some((m) => m.entry_id === "unvalidated"),
        ).toBe(false);
        origin.data.request_id = "admitted-mail";
        const mail = {
          customType: "agent-mail",
          content: JSON.stringify({
            message_ref: { conversation_id: "owner-chat", id: "mail-one" },
            sender: "manager",
            content: { summary: "Attributed report" },
          }),
        };
        await hooks.get("before_agent_start")!({ messageType: "custom", message: mail }, ctx);
        entries.push({ id: "delivered-mail", type: "custom_message", ...mail });
        const commission = requestContent("Continue the report");
        commission.context.push("memory-context:none-relevant");
        expect(
          await hooks.get("tool_call")!(
            { toolName: "send_agent_message", input: { content: commission } },
            ctx,
          ),
        ).toBeUndefined();
        entries.push({
          id: "other-mail",
          type: "custom_message",
          ...mail,
          content: mail.content.replace("mail-one", "mail-two"),
        });
        expect(
          await hooks.get("tool_call")!(
            { toolName: "send_agent_message", input: { content: commission } },
            ctx,
          ),
        ).toMatchObject({ block: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test.each(["manager", "worker", ""])("%s cannot register memory hooks", (role) => {
  vi.stubEnv("AGENT_ROLE", role);
  const hooks: string[] = [];
  extension({ on: (event: string) => hooks.push(event) } as unknown as ExtensionAPI);
  expect(hooks).toEqual([]);
});
