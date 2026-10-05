import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { join } from "node:path";
import { registerCommands } from "../commands.ts";
import { defaultConfig } from "../config.ts";
import { MemoryRuntime } from "../lifecycle.ts";
import { MemoryStore } from "../store.ts";
import { resolveBinding } from "../binding.ts";
import { registryFixture } from "./fixtures.ts";

test("interactive commands preserve scopes, visibility, and deletion confirmation", async () => {
  const fixture = await registryFixture();
  const path = join(fixture.directory, "memory.db");
  const store = await MemoryStore.open(path);
  try {
    const runtime = new MemoryRuntime(store, fixture.root);
    const atlas = await resolveBinding(fixture.root);
    const project = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
    const global = store.remember(null, {
      kind: "preference",
      text: "Prefer TypeScript",
      scope: "global",
    }).record;
    const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
    registerCommands(
      {
        registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) =>
          commands.set(name, command),
      } as unknown as ExtensionAPI,
      runtime,
      path,
      defaultConfig,
    );
    const notices: string[] = [];
    let confirmed = false;
    const ctx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session" },
      ui: {
        notify: (text: string) => notices.push(text),
        confirm: () => Promise.resolve(confirmed),
      },
    } as unknown as ExtensionCommandContext;
    const call = (command: string, args = "") => commands.get(command)!.handler(args, ctx);
    await call("memory-status");
    expect(notices.pop()).toContain("atlas");
    await call("memory-search", "--global PostgreSQL");
    expect(notices.pop()).toBe("No matching global entries for this query.");
    await call("memory-search", "PostgreSQL");
    expect(notices.pop()).toContain("project: atlas");
    await call("memory-open", global.id);
    expect(notices.pop()).toContain("global");
    await call("memory-last");
    expect(notices.pop()).toContain("No memory injection");
    await call("memory-forget", `${project.id} --hard`);
    expect(store.open(atlas, project.id).text).toBe("Use PostgreSQL");
    confirmed = true;
    await call("memory-forget", `${project.id} --hard`);
    expect(() => store.open(atlas, project.id)).toThrow();
    await expect(call("memory-forget", `${global.id} --wrong`)).rejects.toThrow("Usage");
    await call("memory-forget", global.id);
    expect(store.list(null, "global")).toEqual([]);
  } finally {
    store.close();
    await fixture.cleanup();
  }
});
