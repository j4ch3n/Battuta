import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test } from "vitest";
import { join } from "node:path";
import { registerTools } from "../tools.ts";
import { MemoryRuntime } from "../lifecycle.ts";
import { MemoryStore } from "../store.ts";
import { resolveBinding } from "../binding.ts";
import { registryFixture } from "./fixtures.ts";

let fixture: Awaited<ReturnType<typeof registryFixture>>;
let store: MemoryStore | undefined;
afterEach(async () => {
  store?.close();
  store = undefined;
  await fixture?.cleanup();
});
async function setup(confirm = false) {
  fixture = await registryFixture();
  store = await MemoryStore.open(join(fixture.directory, "memory.db"));
  const runtime = new MemoryRuntime(store, fixture.root);
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  registerTools(
    {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    runtime,
  );
  const ctx = {
    sessionManager: { getSessionId: () => "session" },
    hasUI: true,
    ui: { confirm: () => Promise.resolve(confirm) },
  } as unknown as ExtensionToolContext;
  const invoke = (name: string, params: Record<string, unknown>) =>
    tools.get(name)!.execute("call", params, undefined, undefined, ctx);
  return { store, runtime, invoke, atlas: await resolveBinding(fixture.root) };
}

test("global search does not substitute project results and lists show scope", async () => {
  const { store, invoke, atlas } = await setup();
  store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" });
  const search = await invoke("memory_search", { query: "PostgreSQL", scope: "global" });
  expect(search.content).toEqual([
    { type: "text", text: "No matching global entries for this query." },
  ]);
  const list = await invoke("memory_list", { scope: "project" });
  expect(JSON.stringify(list)).toContain("atlas");
  expect(JSON.stringify(list)).toContain("PostgreSQL");
});

test("global writes require explicit user intent and return actual downgraded scope", async () => {
  const { invoke } = await setup();
  expect(
    JSON.stringify(
      await invoke("memory_remember", {
        kind: "preference",
        text: "Prefer summaries",
        scope: "global",
      }),
    ),
  ).toContain("explicit");
  const result = await invoke("memory_remember", {
    kind: "preference",
    text: "Prefer summaries",
    scope: "global",
    userRequested: true,
    globalRequested: true,
  });
  expect(JSON.stringify(result)).toContain("global");
  const downgraded = await invoke("memory_remember", {
    kind: "decision",
    text: "Use api.internal.example.com",
    scope: "global",
    userRequested: true,
    globalRequested: true,
  });
  expect(JSON.stringify(downgraded)).toContain("project");
  expect(JSON.stringify(downgraded)).toContain("downgraded");
});

test.each([false, true])(
  "permanent deletion requires interactive confirmation: %s",
  async (confirmed) => {
    const { store, invoke, atlas } = await setup(confirmed);
    const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
    await invoke("memory_forget", { ref: record.id, hard: true });
    if (confirmed) expect(() => store.open(atlas, record.id)).toThrow();
    else expect(store.open(atlas, record.id).text).toBe("Use PostgreSQL");
  },
);

test("open and paginated listing report the actual scope without leaking other projects", async () => {
  const { store, invoke, atlas } = await setup();
  const first = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.remember(atlas, { kind: "decision", text: "Use TypeScript" });
  expect(JSON.stringify(await invoke("memory_open", { ref: first.id }))).toContain(
    "Use PostgreSQL",
  );
  const page = await invoke("memory_list", { scope: "project", limit: 1 });
  expect(page.details).toMatchObject({ total: 2, nextOffset: 1 });
  const last = await invoke("memory_list", { scope: "project", limit: 1, offset: 1 });
  expect(last.details).toMatchObject({ total: 2, nextOffset: null });
  await fixture.select("harbor");
  expect(JSON.stringify(await invoke("memory_open", { ref: first.id }))).not.toContain(
    "Use PostgreSQL",
  );
});

test("unbound requests can recall global records and cannot silently write project records", async () => {
  const { store, runtime, invoke } = await setup();
  store.remember(null, { kind: "preference", text: "Prefer concise summaries", scope: "global" });
  await fixture.select(null);
  await runtime.start("session", []);
  expect(
    JSON.stringify(await invoke("memory_search", { query: "summaries", scope: "global" })),
  ).toContain("Prefer concise summaries");
  expect(
    JSON.stringify(
      await invoke("memory_remember", {
        kind: "decision",
        text: "Use PostgreSQL",
        userRequested: true,
      }),
    ),
  ).toContain("Select");
  expect(JSON.stringify(await invoke("memory_list", { scope: "project" }))).toContain("Select");
});
