import { afterEach, expect, test, vi } from "vitest";
import { join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MemoryStore } from "../store.ts";
import { MemoryRuntime } from "../lifecycle.ts";
import { resolveBinding } from "../binding.ts";
import { registryFixture } from "./fixtures.ts";
import type { SessionEntry } from "../stone.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerHooks } from "../hooks.ts";
import { captureJob, IndexQueue } from "../index-queue.ts";

let fixture: Awaited<ReturnType<typeof registryFixture>>;
let store: MemoryStore | undefined;
afterEach(async () => {
  vi.useRealTimers();
  store?.close();
  store = undefined;
  await fixture?.cleanup();
});
async function setup() {
  fixture = await registryFixture();
  const path = join(fixture.directory, "memory.db");
  store = await MemoryStore.open(path);
  return {
    store,
    path,
    runtime: new MemoryRuntime(store, fixture.root),
    atlas: await resolveBinding(fixture.root),
  };
}
function branch(topic = "PostgreSQL"): SessionEntry[] {
  return [
    {
      id: `user-${topic}`,
      type: "message",
      message: { role: "user", content: [{ type: "text", text: `Choose ${topic}` }] },
    },
    {
      id: `assistant-${topic}`,
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: `Use ${topic}` }] },
    },
  ];
}
function failIndex(store: MemoryStore) {
  store.stone.db
    .getDb()
    .exec(
      "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON index_state BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
    );
}
function restoreIndex(store: MemoryStore) {
  store.stone.db.getDb().exec("DROP TRIGGER fail_checkpoint");
  vi.setSystemTime(Date.now() + 60000);
}

test("failed settlement survives a new request and keeps its original project", async () => {
  const { store, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store);
  expect(() => runtime.finish("session", "history", branch())).toThrow("unavailable");
  await fixture.select("harbor");
  await runtime.start("session", branch());
  restoreIndex(store);
  runtime.recover();
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  expect(store.list(await resolveBinding(fixture.root), "project")).toEqual([]);
});

test("restart retries immutable redacted private jobs before new requests", async () => {
  const { path, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store!);
  const entries = branch("PostgreSQL; my password is hunter2");
  expect(() => runtime.finish("session", "history", entries)).toThrow();
  const directory = `${path}.queue`;
  const jobFile = readdirSync(directory).find((name) => name.endsWith(".job.json"))!;
  const persisted = readFileSync(join(directory, jobFile), "utf8");
  expect(persisted).not.toContain("hunter2");
  expect(persisted).toContain("REDACTED");
  expect(statSync(join(directory, jobFile)).mode & 0o777).toBe(0o600);
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  entries[0].message!.content = "Different subsequent history";
  restoreIndex(store!);
  store!.close();
  store = await MemoryStore.open(path);
  new MemoryRuntime(store, fixture.root);
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  expect(readdirSync(directory).filter((name) => name.endsWith(".job.json"))).toEqual([]);
});

test("committed job replay after queue-removal crash does not rewrite deleted records", async () => {
  const { path, store, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store);
  expect(() => runtime.finish("session", "history", branch())).toThrow();
  const directory = `${path}.queue`;
  const filename = join(
    directory,
    readdirSync(directory).find((name) => name.endsWith(".job.json"))!,
  );
  const captured = readFileSync(filename, "utf8");
  restoreIndex(store);
  runtime.recover();
  const record = store.list(atlas, "project")[0];
  store.forget(atlas, record.id, true);
  writeFileSync(filename, captured, { mode: 0o600 });
  runtime.recover();
  expect(store.stone.db.getRecord(record.id)).toBeUndefined();
  expect(readdirSync(directory).filter((name) => name.endsWith(".job.json"))).toEqual([]);
});

test.each([false, true])(
  "uncommitted replay respects lifecycle suppression (hard=%s)",
  async (hard) => {
    const { store, runtime, atlas } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    await runtime.start("session", []);
    runtime.finish("session", "history", branch());
    const original = store.list(atlas, "project")[0];
    await runtime.start("another-session", []);
    failIndex(store);
    expect(() => runtime.finish("another-session", "another-history", branch())).toThrow();
    store.forget(atlas, original.id, hard);
    restoreIndex(store);
    runtime.recover();
    expect(store.search(atlas, "PostgreSQL", "project")).toEqual([]);
  },
);

test("queue persistence failure retains work in-process and reports degraded durability", async () => {
  const { path, store, atlas } = await setup();
  // Replace only the empty directory through a file fixture, not permissions
  // that may be bypassed by elevated CI users.
  const { rmdirSync } = await import("node:fs");
  rmdirSync(`${path}.queue`);
  writeFileSync(`${path}.queue`, "blocked");
  const runtime = new MemoryRuntime(store, fixture.root);
  await runtime.start("session", []);
  expect(() => runtime.finish("session", "history", branch())).toThrow(
    /not durable across a crash/,
  );
  expect(store.list(atlas, "project")).toEqual([]);
  expect(runtime.recoveryWarnings().join(" ")).toContain("not durable");
  unlinkSync(`${path}.queue`);
  await runtime.start("session", branch());
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
});

test("a competing consumer claim leaves jobs untouched until the claim is released", async () => {
  const { path, store, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store);
  expect(() => runtime.finish("session", "history", branch())).toThrow();
  restoreIndex(store);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import lockfile from ${JSON.stringify(import.meta.resolve("proper-lockfile"))};
    const release = lockfile.lockSync(${JSON.stringify(`${path}.queue`)});
    process.stdout.write('claimed');
    process.stdin.once('data', () => { release(); process.exit(0); });
  `,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await once(child.stdout, "data");
  try {
    const competitor = new MemoryRuntime(store, fixture.root);
    competitor.recover();
    expect(store.list(atlas, "project")).toEqual([]);
  } finally {
    const exited = once(child, "exit");
    child.stdin.write("release");
    await exited;
  }
  runtime.recover();
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
});

test("malformed jobs are retained without poisoning valid recovery", async () => {
  const { path, store, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store);
  expect(() => runtime.finish("session", "history", branch())).toThrow();
  const bad = join(`${path}.queue`, `${"0".repeat(64)}.job.json`);
  writeFileSync(bad, "{broken", { mode: 0o600 });
  restoreIndex(store);
  runtime.recover();
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  expect(readFileSync(bad, "utf8")).toBe("{broken");
  expect(runtime.recoveryWarnings().join(" ")).toContain("Malformed");
});

test("backoff bounds retry frequency and completion markers roll back with records", async () => {
  const { store, runtime, atlas } = await setup();
  vi.useFakeTimers({ toFake: ["Date"] });
  await runtime.start("session", []);
  failIndex(store);
  expect(() => runtime.finish("session", "history", branch())).toThrow();
  expect(
    store.stone.db.getDb().prepare("SELECT COUNT(*) AS n FROM battuta_index_jobs").get(),
  ).toMatchObject({ n: 0 });
  store.stone.db.getDb().exec("DROP TRIGGER fail_checkpoint");
  runtime.recover();
  expect(store.list(atlas, "project")).toEqual([]);
  vi.setSystemTime(Date.now() + 1001);
  runtime.recover();
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
  expect(
    store.stone.db.getDb().prepare("SELECT COUNT(*) AS n FROM battuta_index_jobs").get(),
  ).toMatchObject({ n: 1 });
});

test("distinct jobs sharing a last-entry checkpoint both index", async () => {
  const { store, runtime, atlas } = await setup();
  await runtime.start("session", []);
  runtime.finish("session", "history", branch());
  const changed = branch("SQLite");
  changed[1].id = "assistant-PostgreSQL";
  await runtime.start("session", []);
  runtime.finish("session", "history", changed);
  expect(store.search(atlas, "SQLite", "project")).toHaveLength(1);
  expect(store.search(atlas, "PostgreSQL", "project")).toHaveLength(1);
});

test("request hooks surface queue persistence degradation instead of silently claiming durability", async () => {
  const { path, runtime } = await setup();
  const { rmdirSync } = await import("node:fs");
  rmdirSync(`${path}.queue`);
  writeFileSync(`${path}.queue`, "blocked");
  const hooks = new Map<string, (event: object, ctx: ExtensionContext) => Promise<unknown>>();
  registerHooks(
    {
      on: (name: string, handler: (event: object, ctx: ExtensionContext) => Promise<unknown>) =>
        hooks.set(name, handler),
    } as unknown as ExtensionAPI,
    runtime,
    {
      enabled: false,
      ownerProfile: false,
      includeGlobal: false,
      maxRecords: 5,
      maxTokens: 1000,
      threshold: 0,
    },
    fixture.directory,
  );
  const notifications: string[] = [];
  const ctx = {
    sessionManager: { getSessionId: () => "session", getBranch: () => [] },
    ui: { setStatus: () => undefined, notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  await hooks.get("before_agent_start")!(
    { prompt: "hello", systemPromptOptions: { sections: {} } },
    ctx,
  );
  expect(notifications.join(" ")).toContain("not crash-durable");
});

test("recovery bounds database work per boundary and continues the remaining jobs later", async () => {
  const { path, store, atlas } = await setup();
  const queue = new IndexQueue(store);
  for (let i = 0; i < 12; i++) {
    queue.enqueue(
      captureJob(store, `request-${i}`, atlas, "session", "history", branch(`Database${i}`)),
    );
  }
  queue.recover();
  expect(store.list(atlas, "project")).toHaveLength(10);
  expect(readdirSync(`${path}.queue`).filter((name) => name.endsWith(".job.json"))).toHaveLength(2);
  queue.recover();
  expect(store.list(atlas, "project")).toHaveLength(12);
});
