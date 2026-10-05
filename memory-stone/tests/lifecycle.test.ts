import { afterEach, expect, test } from "vitest";
import { join } from "node:path";
import { MemoryRuntime } from "../lifecycle.ts";
import { MemoryStore } from "../store.ts";
import { resolveBinding } from "../binding.ts";
import type { SessionEntry } from "../stone.ts";
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
  return {
    store,
    runtime: new MemoryRuntime(store, fixture.root),
    atlas: await resolveBinding(fixture.root),
  };
}
function entry(id: string, role: string, text: string): SessionEntry {
  return {
    id,
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text }] },
  };
}

test("snapshots selection through tools and indexing then observes the next request's selection", async () => {
  const { store, runtime, atlas } = await setup();
  const old = [
    entry("old-user", "user", "Old deployment details"),
    entry("old-assistant", "assistant", "Old deployment answer"),
  ];
  await runtime.start("session", old);
  await fixture.select("harbor");
  expect(await runtime.binding("session")).toEqual(atlas);
  const branch = [
    ...old,
    entry("user", "user", "Choose PostgreSQL"),
    entry("assistant", "assistant", "PostgreSQL provides transactions"),
  ];
  runtime.finish("session", join(fixture.directory, "session.jsonl"), branch);
  expect(
    store
      .list(atlas, "project")
      .map((r) => r.text)
      .join(" "),
  ).toContain("PostgreSQL");
  expect(
    store
      .list(atlas, "project")
      .map((r) => r.text)
      .join(" "),
  ).not.toContain("Old deployment");
  expect(store.list(await resolveBinding(fixture.root), "project")).toEqual([]);
  await runtime.start("session", branch);
  expect((await runtime.binding("session"))?.name).toBe("harbor");
});

test("missing selection stays unbound for the request and does not backfill into the next project", async () => {
  const { store, runtime, atlas } = await setup();
  await fixture.select(null);
  await runtime.start("session", []);
  await fixture.select("atlas");
  expect(await runtime.binding("session")).toBeNull();
  const old = [entry("unbound", "user", "Unbound endpoint details")];
  runtime.finish("session", join(fixture.directory, "session.jsonl"), old);
  await runtime.start("session", old);
  runtime.finish("session", join(fixture.directory, "session.jsonl"), [
    ...old,
    entry("user", "user", "Choose PostgreSQL"),
    entry("assistant", "assistant", "Use PostgreSQL"),
  ]);
  expect(
    store
      .list(atlas, "project")
      .map((r) => r.text)
      .join(" "),
  ).not.toContain("Unbound endpoint");
});

test("indexing checkpoint and FTS roll back on failure and the same request can retry", async () => {
  const { store, runtime, atlas } = await setup();
  await runtime.start("session", []);
  const branch = [
    entry("user", "user", "Choose PostgreSQL"),
    entry("assistant", "assistant", "Use PostgreSQL"),
  ];
  const file = join(fixture.directory, "session.jsonl");
  store.stone.db
    .getDb()
    .exec(
      "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON index_state BEGIN SELECT RAISE(ABORT, 'checkpoint failure'); END",
    );
  expect(() => runtime.finish("session", file, branch)).toThrow("checkpoint failure");
  expect(store.list(atlas, "project")).toEqual([]);
  expect(store.stone.db.getIndexState(file)).toBeUndefined();
  store.stone.db.getDb().exec("DROP TRIGGER reject_checkpoint");
  runtime.finish("session", file, branch);
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  expect(store.stone.db.getIndexState(file)?.last_indexed_entry_id).toBe("assistant");
  runtime.finish("session", file, branch);
  expect(store.list(atlas, "project")).toHaveLength(1);
});

test("injection labels project/global context and bounds its size", async () => {
  const { store, runtime, atlas } = await setup();
  store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" });
  store.remember(null, {
    kind: "preference",
    text: "Prefer PostgreSQL discussions in brief summaries",
    scope: "global",
  });
  await runtime.start("session", []);
  const injected = runtime.inject("session", "PostgreSQL", {
    enabled: true,
    maxRecords: 5,
    maxTokens: 1000,
    threshold: 0,
    includeGlobal: true,
  });
  expect(injected).toContain("project: atlas");
  expect(injected).toContain("global");
  expect(
    runtime.inject("session", "PostgreSQL", {
      enabled: false,
      maxRecords: 5,
      maxTokens: 1000,
      threshold: 0,
      includeGlobal: true,
    }),
  ).toBe("");
  expect(
    runtime.inject("session", "PostgreSQL", {
      enabled: true,
      maxRecords: 1,
      maxTokens: 50,
      threshold: 0,
      includeGlobal: false,
    }).length,
  ).toBeLessThanOrEqual(200);
});

test("automatic history redacts conversational credentials in users, thinking, and errors before truncation", async () => {
  const { store, runtime, atlas } = await setup();
  await runtime.start("session", []);
  runtime.finish("session", join(fixture.directory, "session.jsonl"), [
    entry("user", "user", "My production password is hunter2"),
    {
      id: "assistant",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "The API key is plain-key-value" }],
      },
    },
    {
      id: "error",
      type: "message",
      message: {
        role: "toolResult",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "Our access token was sensitive-token-value" }],
      },
    },
  ]);
  const text = store
    .list(atlas, "project")
    .map((record) => record.text)
    .join("\n");
  expect(text).not.toContain("hunter2");
  expect(text).not.toContain("plain-key-value");
  expect(text).not.toContain("sensitive-token-value");
  expect(text).toContain("REDACTED");
});
