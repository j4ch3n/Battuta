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
async function setup() {
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
    ui: {
      confirm: () => {
        throw new Error("Deletion must not request owner confirmation");
      },
    },
  } as unknown as ExtensionToolContext;
  const invoke = (name: string, params: Record<string, unknown>) =>
    tools.get(name)!.execute("call", params, undefined, undefined, ctx);
  return { store, runtime, invoke, tools, ctx, atlas: await resolveBinding(fixture.root) };
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

test("bots choose global scope without approval and receive actual downgraded scope", async () => {
  const { invoke } = await setup();
  const result = await invoke("memory_remember", {
    kind: "preference",
    text: "Prefer summaries",
    scope: "global",
  });
  expect(result.details).toMatchObject({ scope: "global", downgraded: false });
  const downgraded = await invoke("memory_remember", {
    kind: "decision",
    text: "Use api.internal.example.com",
    scope: "global",
  });
  expect(JSON.stringify(downgraded)).toContain("project");
  expect(JSON.stringify(downgraded)).toContain("downgraded");
});

test.each([false, true])(
  "automatic permanent deletion works with hasUI=%s and suppresses replay",
  async (hasUI) => {
    const { store, invoke, ctx, atlas } = await setup();
    Object.assign(ctx, { hasUI });
    const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
    const deleted = await invoke("memory_forget", { ref: record.id });
    expect(deleted.details).toMatchObject({ deleted: true, store: "SQLite" });
    expect(store.stone.db.getRecord(record.id)).toBeUndefined();
    expect(
      store.write({
        kind: "decision",
        text: "Use PostgreSQL",
        scope: record.scope,
        project_id: record.project_id,
      }),
    ).toBeUndefined();
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
      }),
    ),
  ).toContain("Select");
  expect(JSON.stringify(await invoke("memory_list", { scope: "project" }))).toContain("Select");
});

test("correction history remains inspectable without a retirement tool", async () => {
  const { store, invoke, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  await invoke("memory_replace", {
    ref: record.id,
    kind: "decision",
    text: "Use SQLite",
  });
  expect(store.search(atlas, "PostgreSQL", "project")).toEqual([]);
  expect((await invoke("memory_list", { status: "soft_forgotten" })).details).toMatchObject({
    total: 1,
  });
  expect(
    (await invoke("memory_open", { ref: record.id, status: "soft_forgotten" })).details,
  ).toMatchObject({ record: { status: "soft_forgotten" } });
});

test("default forgetting permanently deletes correction history", async () => {
  const { store, invoke, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  await invoke("memory_replace", {
    ref: record.id,
    kind: "decision",
    text: "Use SQLite",
  });
  expect(store.stone.db.getRecord(record.id)?.status).toBe("soft_forgotten");
  await invoke("memory_forget", { ref: record.id });
  expect(store.stone.db.getRecord(record.id)).toBeUndefined();
});

test("forgetting needs only a reference with no retirement tool, intent flag or mode flags", async () => {
  const { store, invoke, tools, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  await invoke("memory_forget", { ref: record.id });
  expect(store.stone.db.getRecord(record.id)).toBeUndefined();
  expect(tools.has("memory_retire")).toBe(false);
  expect(tools.get("memory_forget")!.parameters).toMatchObject({
    required: ["ref"],
  });
  expect(tools.get("memory_forget")!.parameters).not.toHaveProperty("properties.hard");
  expect(tools.get("memory_forget")!.parameters).not.toHaveProperty("properties.operation");
  expect(tools.get("memory_forget")!.parameters).not.toHaveProperty("properties.userRequested");
});

test("aborted deletion does not mutate", async () => {
  const { store, tools, ctx, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  await tools
    .get("memory_forget")!
    .execute("call", { ref: record.id }, AbortSignal.abort(), undefined, ctx);
  expect(store.open(atlas, record.id).status).toBe("active");
});

test.each(["project", "global"] as const)(
  "correction tool autonomously preserves %s scope",
  async (scope) => {
    const { store, invoke, atlas } = await setup();
    const record = store.remember(atlas, {
      kind: "preference",
      text: "Prefer concise summaries",
      scope,
    }).record;
    const saved = await invoke("memory_replace", {
      ref: record.id,
      kind: "preference",
      text: "Prefer detailed summaries",
    });
    expect(saved.details).toMatchObject({ store: "SQLite", retiredRef: record.id, scope });
    expect(store.list(atlas, scope).map((item) => item.text)).toEqual([
      "Prefer detailed summaries",
    ]);
  },
);

test("bots manage global memory without a selected project or owner request", async () => {
  const { store, invoke, runtime } = await setup();
  await fixture.select(null);
  await runtime.start("session", []);
  const saved = await invoke("memory_remember", {
    kind: "preference",
    text: "Enjoys hiking",
    scope: "global",
  });
  expect(saved.details).toMatchObject({ scope: "global", downgraded: false });
  const ref = (saved.details as { ref: string }).ref;
  const corrected = await invoke("memory_replace", {
    ref,
    kind: "preference",
    text: "Enjoys hiking and swimming",
  });
  expect(corrected.details).toMatchObject({ scope: "global", retiredRef: ref });
  const replacement = (corrected.details as { ref: string }).ref;
  expect((await invoke("memory_forget", { ref: replacement })).details).toMatchObject({
    deleted: true,
  });
  expect(store.stone.db.getRecord(replacement)).toBeUndefined();
});

test("aborting while request binding is pending retains the record", async () => {
  const { store, runtime, tools, ctx, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  const controller = new AbortController();
  const binding = runtime.binding.bind(runtime);
  runtime.binding = async (sessionId) => {
    const bound = await binding(sessionId);
    controller.abort();
    return bound;
  };
  await tools
    .get("memory_forget")!
    .execute("delete", { ref: record.id }, controller.signal, undefined, ctx);
  expect(store.open(atlas, record.id).status).toBe("active");
});

test("automatic deletion rejects an active reference from another project", async () => {
  const { store, invoke, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  await fixture.select("harbor");
  const deleted = await invoke("memory_forget", { ref: record.id });
  expect(deleted.details).toMatchObject({ error: true });
  expect(store.stone.db.getRecord(record.id)).toBeDefined();
});

test("retired references from another project cannot be inspected or deleted", async () => {
  const { store, invoke, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.forget(atlas, record.id);
  await fixture.select("harbor");
  expect(
    (await invoke("memory_open", { ref: record.id, status: "soft_forgotten" })).details,
  ).toMatchObject({ error: true });
  expect((await invoke("memory_forget", { ref: record.id })).details).toMatchObject({
    error: true,
  });
  expect(store.stone.db.getRecord(record.id)?.status).toBe("soft_forgotten");
});
