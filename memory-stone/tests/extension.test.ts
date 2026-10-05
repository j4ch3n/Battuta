import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { join } from "node:path";
import bridge from "../index.ts";
import { registryFixture } from "./fixtures.ts";
import type { SessionEntry } from "../stone.ts";

test("the extension registers scoped tools and hooks that index only a bound request", async () => {
  const fixture = await registryFixture();
  type Hook = (
    event: { prompt: string; systemPrompt: string },
    ctx: ExtensionContext,
  ) => Promise<unknown>;
  const hooks = new Map<string, Hook>();
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) =>
      commands.set(name, command),
    on: (event: string, handler: Hook) => hooks.set(event, handler),
  } as unknown as ExtensionAPI;
  let branch: SessionEntry[] = [];
  const ctx = {
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => join(fixture.directory, "session.jsonl"),
      getBranch: () => branch,
    },
    ui: { setStatus: () => undefined, notify: () => undefined },
    hasUI: true,
  } as unknown as ExtensionContext;
  try {
    await bridge(pi, {
      databasePath: join(fixture.directory, "memory.db"),
      projectsRoot: fixture.root,
      agentDirectory: join(fixture.directory, "agent"),
    });
    expect([...tools.keys()].sort()).toEqual([
      "memory_forget",
      "memory_list",
      "memory_open",
      "memory_remember",
      "memory_search",
    ]);
    expect(commands.has("memory-status")).toBe(true);
    const started = await hooks.get("before_agent_start")!(
      { prompt: "Use PostgreSQL", systemPrompt: "Bot instructions" },
      ctx,
    );
    expect(JSON.stringify(started)).toContain("atlas");
    await fixture.select("harbor");
    branch = [
      { id: "user", type: "message", message: { role: "user", content: "Use PostgreSQL" } },
      {
        id: "assistant",
        type: "message",
        message: { role: "assistant", content: "PostgreSQL supports transactions" },
      },
    ];
    await hooks.get("agent_settled")?.({ prompt: "", systemPrompt: "" }, ctx);
    await fixture.select("atlas");
    const result = await tools
      .get("memory_search")!
      .execute(
        "call",
        { query: "PostgreSQL", scope: "project" },
        undefined,
        undefined,
        ctx as unknown as ExtensionToolContext,
      );
    expect(JSON.stringify(result)).toContain("PostgreSQL supports transactions");
    expect(JSON.stringify(result)).toContain("atlas");
  } finally {
    await hooks.get("session_shutdown")?.({ prompt: "", systemPrompt: "" }, ctx);
    await fixture.cleanup();
  }
});

test.each(["automatic retry", "mail pre-settle continuation"])(
  "binding and history survive %s after agent_end",
  async () => {
    const fixture = await registryFixture();
    type Hook = (event: object, ctx: ExtensionContext) => Promise<unknown>;
    const hooks = new Map<string, Hook>();
    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const pi = {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
      registerCommand: () => undefined,
      on: (event: string, handler: Hook) => hooks.set(event, handler),
    } as unknown as ExtensionAPI;
    let branch: SessionEntry[] = [];
    const ctx = {
      sessionManager: {
        getSessionId: () => "continued",
        getSessionFile: () => join(fixture.directory, "continued.jsonl"),
        getBranch: () => branch,
      },
      ui: { setStatus: () => undefined, notify: () => undefined },
      hasUI: true,
    } as unknown as ExtensionContext;
    try {
      await bridge(pi, {
        databasePath: join(fixture.directory, "memory.db"),
        projectsRoot: fixture.root,
        agentDirectory: join(fixture.directory, "agent"),
      });
      await hooks.get("before_agent_start")!(
        { prompt: "Choose PostgreSQL", systemPrompt: "Instructions" },
        ctx,
      );
      branch = [
        { id: "user", type: "message", message: { role: "user", content: "Choose PostgreSQL" } },
        {
          id: "first",
          type: "message",
          message: { role: "assistant", content: "Initial response" },
        },
      ];
      await fixture.select("harbor");
      await hooks.get("agent_end")?.({}, ctx);
      const saved = await tools
        .get("memory_remember")!
        .execute(
          "save",
          { kind: "decision", text: "Use PostgreSQL transactions", userRequested: true },
          undefined,
          undefined,
          ctx as unknown as ExtensionToolContext,
        );
      expect(saved.details).toMatchObject({ project: "atlas" });
      branch.push({
        id: "last",
        type: "message",
        message: { role: "assistant", content: "Final continued response" },
      });
      await hooks.get("agent_end")?.({}, ctx);
      await hooks.get("agent_settled")?.({}, ctx);
      await fixture.select("atlas");
      const listed = await tools
        .get("memory_list")!
        .execute(
          "list",
          { scope: "project" },
          undefined,
          undefined,
          ctx as unknown as ExtensionToolContext,
        );
      expect(JSON.stringify(listed)).toContain("Final continued response");
      await fixture.select("harbor");
      const harbor = await tools
        .get("memory_list")!
        .execute(
          "list",
          { scope: "project" },
          undefined,
          undefined,
          ctx as unknown as ExtensionToolContext,
        );
      expect(harbor.details).toMatchObject({ total: 0 });
    } finally {
      await hooks.get("session_shutdown")?.({}, ctx);
      await fixture.cleanup();
    }
  },
);
