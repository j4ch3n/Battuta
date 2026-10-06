import { afterEach, expect, test } from "vitest";
import { join } from "node:path";
import { MemoryStore } from "../store.ts";
import { resolveBinding } from "../binding.ts";
import { registryFixture } from "./fixtures.ts";

let fixture: Awaited<ReturnType<typeof registryFixture>> | undefined;
let store: MemoryStore | undefined;
afterEach(async () => {
  store?.close();
  store = undefined;
  await fixture?.cleanup();
});
async function setup() {
  fixture = await registryFixture();
  store = await MemoryStore.open(join(fixture.directory, "memory/memory.db"));
  return { fixture, store, atlas: await resolveBinding(fixture.root) };
}

test("isolates identical text across projects and global scope and allows cross-bot recall", async () => {
  const { fixture, store, atlas } = await setup();
  await fixture.select("harbor");
  const harbor = await resolveBinding(fixture.root);
  const a = store.remember(atlas, {
    kind: "decision",
    text: "Use concise summaries",
    scope: "project",
  });
  const h = store.remember(harbor, {
    kind: "decision",
    text: "Use concise summaries",
    scope: "project",
  });
  const g = store.remember(null, {
    kind: "preference",
    text: "Use concise summaries",
    scope: "global",
  });
  expect(new Set([a.record.id, h.record.id, g.record.id]).size).toBe(3);
  expect(store.search(atlas, "summaries", "project").map((r) => r.record.id)).toEqual([
    a.record.id,
  ]);
  expect(store.search(null, "summaries", "global").map((r) => r.record.id)).toEqual([g.record.id]);
  expect(() => store.open(harbor, a.record.id)).toThrow(/available/);
  expect(() => store.forget(harbor, a.record.id)).toThrow(/available/);
  expect(store.open(harbor, g.record.id).scope).toBe("global");
});

test("lists all matching-scope records rather than treating bounded search as enumeration", async () => {
  const { store, atlas } = await setup();
  for (const text of ["Use PostgreSQL", "Use TypeScript", "Prefer summaries"])
    store.remember(atlas, { kind: "decision", text });
  store.remember(null, { kind: "preference", text: "Prefer brief answers", scope: "global" });
  expect(store.list(atlas, "project").length).toBe(3);
  expect(store.list(null, "global").map((r) => r.text)).toEqual(["Prefer brief answers"]);
  expect(() => store.list(null, "project")).toThrow(/select/i);
});

test("refuses credentials and downgrades internal global details only into a valid project", async () => {
  const { store, atlas } = await setup();
  expect(() =>
    store.remember(atlas, { kind: "decision", text: "password=secret123", scope: "global" }),
  ).toThrow(/secret/i);
  expect(() =>
    store.remember(null, {
      kind: "decision",
      text: "Endpoint api.internal.example.com",
      scope: "global",
    }),
  ).toThrow(/project/i);
  const result = store.remember(atlas, {
    kind: "decision",
    text: "Endpoint api.internal.example.com",
    scope: "global",
  });
  expect(result.downgraded).toBe(true);
  expect(result.record.scope).toBe("project");
  expect(store.list(null, "global")).toEqual([]);
});

test("checks sensitive tags and preserves safe identity preferences", async () => {
  const { store, atlas } = await setup();
  expect(
    store.remember(null, {
      kind: "preference",
      text: "My GitHub handle is alexdev",
      scope: "global",
    }).record.scope,
  ).toBe("global");
  expect(
    store.remember(atlas, {
      kind: "preference",
      text: "Prefer summaries",
      tags: "src/internal.ts",
      scope: "global",
    }).record.scope,
  ).toBe("project");
  expect(() =>
    store.remember(atlas, {
      kind: "preference",
      text: "Prefer summaries",
      tags: "password=secret123",
    }),
  ).toThrow(/secret/i);
});

test("rolls back record and FTS writes together and preserves forgotten state", async () => {
  const { store, atlas } = await setup();
  expect(() =>
    store.transaction(() => {
      store.remember(atlas, { kind: "decision", text: "Use rollback testing" });
      throw new Error("interrupted");
    }),
  ).toThrow("interrupted");
  expect(store.search(atlas, "rollback", "project")).toEqual([]);
  const result = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" });
  store.forget(atlas, result.record.id);
  expect(store.search(atlas, "PostgreSQL", "project")).toEqual([]);
  expect(() => store.open(atlas, result.record.id)).toThrow(/available/);
});

test("an explicit request can remember previously forgotten content again", async () => {
  const { store, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.forget(atlas, record.id);
  expect(store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record.status).toBe(
    "active",
  );
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
});

test("records in another scope cannot crowd a matching record out of search candidates", async () => {
  const { store, atlas } = await setup();
  const project = store.remember(atlas, {
    kind: "decision",
    text: `projectneedle ${"rationale ".repeat(100)}`,
  }).record;
  const global = store.remember(null, {
    kind: "preference",
    scope: "global",
    text: `globalneedle ${"preference ".repeat(100)}`,
  }).record;
  for (let index = 0; index < 60; index++) {
    store.remember(null, { kind: "preference", scope: "global", text: `projectneedle ${index}` });
    store.remember(atlas, { kind: "decision", text: `globalneedle ${index}` });
  }
  expect(store.search(atlas, "projectneedle", "project").map((item) => item.record.id)).toEqual([
    project.id,
  ]);
  expect(store.search(null, "globalneedle", "global").map((item) => item.record.id)).toEqual([
    global.id,
  ]);
});

test.each([
  "My production password is hunter2",
  "The API key is plain-key-value",
  "Our access token was sensitive-token-value",
])("refuses conversational credentials: %s", async (text) => {
  const { store, atlas } = await setup();
  expect(() => store.remember(atlas, { kind: "preference", text, scope: "global" })).toThrow(
    /secret|credential/i,
  );
  expect(() => store.remember(atlas, { kind: "decision", text })).toThrow(/secret|credential/i);
  expect(store.list(null, "global")).toEqual([]);
  expect(store.list(atlas, "project")).toEqual([]);
});

test.each(["decision", "preference"] as const)(
  "internal details without hostnames cannot be global even when classified as %s",
  async (kind) => {
    const { store, atlas } = await setup();
    const text =
      "Internal implementation detail: invoice reconciliation uses the customer_ledger table and a nightly settlement worker";
    const result = store.remember(atlas, { kind, text, scope: "global" });
    expect(result.record.scope).toBe("project");
    expect(result.downgraded).toBe(true);
    expect(() => store.remember(null, { kind, text, scope: "global" })).toThrow(/project/i);
    expect(store.list(null, "global")).toEqual([]);
  },
);

test("safe cross-project credential-handling preferences remain globally eligible", async () => {
  const { store } = await setup();
  expect(
    store.remember(null, {
      kind: "preference",
      text: "I prefer using a password manager",
      scope: "global",
    }).record.scope,
  ).toBe("global");
});

test.each([
  ["turn_summary", "I grew up in Toronto and enjoy hiking"],
  ["decision", "My enduring goal is to learn Spanish"],
] as const)("non-sensitive personal %s records remain cross-project", async (kind, text) => {
  const { store } = await setup();
  expect(store.remember(null, { kind, text, scope: "global" }).record.scope).toBe("global");
});

test.each(["task", "error_resolution"] as const)("%s remains project-scoped", async (kind) => {
  const { store, atlas } = await setup();
  expect(
    store.remember(atlas, { kind, text: "Finish the migration", scope: "global" }).record.scope,
  ).toBe("project");
});

test("retired records require explicit status selection and can be permanently deleted", async () => {
  const { store, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.forget(atlas, record.id);
  expect(store.list(atlas, "project")).toEqual([]);
  expect(store.list(atlas, "project", "soft_forgotten").map((item) => item.id)).toEqual([
    record.id,
  ]);
  expect(store.open(atlas, record.id, "soft_forgotten").text).toBe("Use PostgreSQL");
  store.forget(atlas, record.id, true);
  expect(store.stone.db.getRecord(record.id)).toBeUndefined();
});

test.each([false, true])(
  "automatic writes cannot restore forgotten content (hard=%s)",
  async (hard) => {
    const { store, atlas } = await setup();
    const input = {
      kind: "decision" as const,
      text: "Use PostgreSQL",
      project_id: atlas.projectId,
    };
    const record = store.remember(atlas, input).record;
    store.forget(atlas, record.id, hard);
    expect(store.write(input)).toBeUndefined();
    expect(store.search(atlas, "PostgreSQL", "project")).toEqual([]);
    expect(store.remember(atlas, input).record.status).toBe("active");
  },
);

test("correction retires predecessor atomically and invalid correction preserves it", async () => {
  const { store, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  expect(() =>
    store.replace(atlas, record.id, { kind: "decision", text: "password=secret123" }),
  ).toThrow();
  expect(store.open(atlas, record.id).text).toBe("Use PostgreSQL");
  const saved = store.replace(atlas, record.id, { kind: "decision", text: "Use SQLite" });
  expect(saved.record.text).toBe("Use SQLite");
  expect(store.open(atlas, record.id, "soft_forgotten").status).toBe("soft_forgotten");
  expect(store.search(atlas, "PostgreSQL", "project")).toEqual([]);
});

test("a retirement failure rolls back correction, suppression, and recalled packet cleanup", async () => {
  const { store, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.stone.db.insertInjection({
    session_id: "session",
    prompt_hash: "prompt",
    injected_refs: record.id,
    packet: "Use PostgreSQL",
    reasons: "test",
  });
  const db = store.stone.db.getDb();
  db.exec(
    "CREATE TRIGGER fail_retirement BEFORE UPDATE OF status ON records BEGIN SELECT RAISE(ABORT, 'retirement failed'); END",
  );
  expect(() => store.replace(atlas, record.id, { kind: "decision", text: "Use SQLite" })).toThrow(
    /retirement failed/,
  );
  expect(store.list(atlas, "project").map((item) => item.text)).toEqual(["Use PostgreSQL"]);
  expect(store.stone.db.getLastInjection("session")?.packet).toBe("Use PostgreSQL");
  expect(db.prepare("SELECT COUNT(*) AS n FROM battuta_suppression").get()).toMatchObject({ n: 0 });
});

test("permanent deletion cleans FTS, activity, and recalled packets atomically", async () => {
  const { store, atlas } = await setup();
  const record = store.remember(atlas, { kind: "decision", text: "Use PostgreSQL" }).record;
  store.stone.db.insertFileActivity({
    record_id: record.id,
    project_id: atlas.projectId,
    path: "src/db.ts",
    action: "read",
    entry_id: "entry",
  });
  store.stone.db.insertInjection({
    session_id: "session",
    prompt_hash: "prompt",
    injected_refs: record.id,
    packet: "Use PostgreSQL",
    reasons: "test",
  });
  const db = store.stone.db.getDb();
  const rowid = (
    db.prepare("SELECT rowid FROM records WHERE id = ?").get(record.id) as { rowid: number }
  ).rowid;
  db.exec(
    "CREATE TRIGGER fail_deletion BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
  );
  expect(() => store.forget(atlas, record.id, true)).toThrow(/delete failed/);
  expect(store.stone.db.getLastInjection("session")?.packet).toBe("Use PostgreSQL");
  expect(store.stone.db.getRecentFilePaths(atlas.projectId)).toContain("src/db.ts");
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  db.exec("DROP TRIGGER fail_deletion");
  store.forget(atlas, record.id, true);
  expect(db.prepare("SELECT rowid FROM record_fts WHERE rowid = ?").get(rowid)).toBeUndefined();
  expect(store.stone.db.getLastInjection("session")).toBeUndefined();
  expect(store.stone.db.getRecentFilePaths(atlas.projectId)).toEqual([]);
});
