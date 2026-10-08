import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { mkdtemp, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createOpenCodeAdapter } from "../opencode.ts";
import type { AdapterDependencies } from "../opencode.ts";
import type { WorkerConfig } from "../config.ts";
import { prepareWorktree } from "../worktree.ts";
import { buildPrompt } from "../prompt.ts";
import { task, report } from "./fixtures.ts";
import { runDaemon } from "../daemon.ts";
import type { TaskRow } from "../../supabase/functions/_shared/task-contracts.ts";
import type { OpenCodeAdapter } from "../opencode.ts";

let root: string;
let directory: string;
let config: WorkerConfig;
let routes: Record<string, unknown>;
let requests: {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
  signal?: AbortSignal | null;
}[];
let deps: AdapterDependencies;
let ensure: MockInstance<typeof Service.ensure>;
let stop: MockInstance<typeof Service.stop>;
const bound = { ...task, opencode_session_id: "ses_example" };
const promptId = "msg_battuta_12345678123412341234123456789abc";
const resultBlock = `\`\`\`battuta-result\n${JSON.stringify(report)}\n\`\`\``;
function assistant(text = resultBlock, created = 20): Record<string, unknown> {
  return {
    id: `msg_${created}`,
    type: "assistant",
    time: { created, completed: created + 1 },
    agent: "build",
    model: { id: "test", providerID: "test" },
    content: [{ type: "text", text }],
    finish: "stop",
  };
}
beforeEach(async () => {
  ensure = vi.spyOn(Service, "ensure").mockRejectedValue(new Error("must never ensure service"));
  stop = vi.spyOn(Service, "stop").mockRejectedValue(new Error("must never stop service"));
  root = await mkdtemp(join(await realpath(tmpdir()), "battuta-native-"));
  const checkout = join(root, "checkout");
  execFileSync("git", ["init", "-b", "main", checkout]);
  execFileSync("git", [
    "-C",
    checkout,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "base",
  ]);
  config = {
    workerId: "worker-1",
    projects: { [task.project]: { checkout, baseRef: "HEAD" } },
    worktreeRoot: join(root, "trees"),
    lockPath: join(root, "lock"),
    capacity: 1,
    reconcileMs: 10000,
    model: { providerID: "test", modelID: "model-test" },
  };
  directory = await prepareWorktree(task, config);
  const session = {
    id: "ses_example",
    projectID: "proj_example",
    agent: "build",
    model: { id: "model-test", providerID: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory },
    metadata: {
      battuta: { schema_version: 1, task_id: task.id, worker_id: "worker-1", delegator_role: "tl" },
    },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  };
  routes = {
    "GET /api/info": { version: "2.0.24", pid: 123, urls: ["http://fake"], paths: { tmp: root } },
    "GET /api/session": { data: [session], cursor: {} },
    "POST /api/session": { data: session },
    "GET /api/session/ses_example": { data: session },
    "GET /api/session/active": { data: {} },
    "GET /api/session/ses_example/inbox": { data: [] },
    "GET /api/session/ses_example/form": { data: [] },
    "GET /api/config": [],
    "GET /api/agent/build": {
      data: {
        id: "build",
        name: "build",
        request: {},
        mode: "primary",
        hidden: false,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      },
    },
    "GET /api/session/ses_example/message": {
      data: [
        { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
        assistant(),
      ],
      cursor: {},
    },
    "GET /api/session/ses_example/permission": { data: [] },
    "POST /api/session/ses_example/prompt": {
      data: {
        id: promptId,
        sessionID: "ses_example",
        type: "user",
        time: { created: 10 },
        payload: { text: buildPrompt(task), metadata: session.metadata },
        delivery: "queue",
      },
    },
  };
  const locationQuery = new URLSearchParams({ "location[directory]": directory }).toString();
  routes[`GET /api/config?${locationQuery}`] = [];
  routes[`GET /api/agent/build?${locationQuery}`] = routes["GET /api/agent/build"];
  routes["GET /api/session/ses_example/message?order=asc"] =
    routes["GET /api/session/ses_example/message"];
  routes["GET /api/session?order=asc"] = routes["GET /api/session"];
  requests = [];
  deps = {
    serviceFile: join(root, "service.json"),
    service: {
      discover: () =>
        Promise.resolve({
          url: "http://fake",
          auth: { type: "basic", username: "test", password: "secret" },
        }),
      headers: () => ({ authorization: "Basic fake-auth" }),
    },
    makeClient: (options) =>
      OpenCode.make({
        ...options,
        fetch: async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          const method = init?.method ?? "GET";
          const key = `${method} ${url.pathname}${url.search}`;
          requests.push({
            method,
            path: url.pathname + url.search,
            body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
            authorization: new Headers(init?.headers).get("authorization"),
            signal: init?.signal,
          });
          const value = await routes[key];
          if (value instanceof Error) throw value;
          if (value instanceof Response) return value;
          if (value === "hang") return new Promise<Response>(() => {});
          if (value === undefined) return new Response("missing fake route", { status: 404 });
          return Response.json(value);
        },
      }),
  };
  // Extra runtime traps are deliberately outside the discover/headers-only contract.
  Object.assign(deps.service, { ensure, stop });
});

function daemonFixture(adapter: OpenCodeAdapter, initial: TaskRow[]) {
  const owned = initial;
  const controller = new AbortController();
  const cleanup = vi.fn();
  const log = vi.fn();
  const claim = vi.fn(() => {
    const row = structuredClone(task);
    owned.push(row);
    return Promise.resolve(row);
  });
  const finalize = vi.fn(() => Promise.resolve(bound));
  const close = vi.spyOn(adapter, "close");
  const running = runDaemon(
    {
      config,
      tasks: {
        principal: { role: "worker", worker_id: "worker-1", projects: [task.project] },
        client: {
          listOwned: () => Promise.resolve({ tasks: [...owned], next: null }),
          claim,
          bind: (id, sessionID) => {
            const row = owned.find((row) => row.id === id)!;
            row.opencode_session_id = sessionID;
            return Promise.resolve(row);
          },
          finalize,
        },
      },
      opencode: {
        ...adapter,
        events: async function* (signal) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "closed" };
        },
      },
      prepareWorktree: () => Promise.resolve(directory),
      subscribeQueue: () => Promise.resolve(cleanup),
      log,
    },
    controller.signal,
  );
  return { owned, controller, cleanup, close, log, claim, finalize, running };
}

it.each(["user", "synthetic"])(
  "retains ownership and blocks finalization/new claims after later delivered %s input",
  async (type) => {
    routes["GET /api/session/ses_example/message?order=asc"] = {
      data: [
        { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
        assistant(),
        { id: "msg_later", type, time: { created: 30 }, text: "more work" },
        { id: "msg_idle", type: "idle", time: { created: 40 }, outcome: "interrupted" },
      ],
      cursor: {},
    };
    const adapter = await createOpenCodeAdapter(config, deps);
    const snapshot = await adapter.inspect(bound);
    const f = daemonFixture(adapter, [structuredClone(bound)]);
    await vi.waitFor(() =>
      expect(f.log).toHaveBeenCalledWith("recovery_required", expect.any(String)),
    );
    f.controller.abort();
    await f.running;
    expect(snapshot.active).toBe(false);
    expect(snapshot.pendingInputs).toEqual([]);
    expect(snapshot.report).toBeUndefined();
    expect(f.finalize).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.owned).toEqual([bound]);
    expect(f.cleanup).toHaveBeenCalledOnce();
  },
);

it.each([20, 30, 40])(
  "checks synthetic input ordering against final assistant at %s",
  async (created) => {
    routes["GET /api/session/ses_example/message?order=asc"] = {
      data: [
        { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
        assistant(),
        { id: "msg_synthetic", type: "synthetic", time: { created: 30 }, text: "continue" },
        ...(created === 20 ? [] : [assistant(resultBlock, created)]),
        { id: "msg_idle", type: "idle", time: { created: 50 }, outcome: "succeeded" },
      ],
      cursor: {},
    };
    const adapter = await createOpenCodeAdapter(config, deps);
    const snapshot = await adapter.inspect(bound);
    if (created === 40) expect(snapshot.report).toEqual(report);
    else {
      expect(snapshot.report).toBeUndefined();
      expect(snapshot.reportError).toMatch(/ambiguous/);
    }
  },
);

it.each(["config", "permission"])(
  "shutdown during deferred native %s preflight never POSTs",
  async (kind) => {
    routes["GET /api/session?order=asc"] = { data: [], cursor: {} };
    const key =
      kind === "config"
        ? "GET /api/config?" + new URLSearchParams({ "location[directory]": directory }).toString()
        : "GET /api/session/ses_example/permission";
    let release!: (value: unknown) => void;
    routes[key] = new Promise((resolve) => {
      release = resolve;
    });
    const adapter = await createOpenCodeAdapter(config, deps);
    const f = daemonFixture(adapter, []);
    await vi.waitFor(() =>
      expect(requests.some((request) => `${request.method} ${request.path}` === key)).toBe(true),
    );
    f.controller.abort();
    await vi.waitFor(() => expect(f.cleanup).toHaveBeenCalledOnce());
    expect(
      requests.find((request) => `${request.method} ${request.path}` === key)?.signal?.aborted,
    ).toBe(true);
    release(kind === "config" ? [] : { data: [] });
    await f.running;
    expect(requests.filter((request) => request.path.endsWith("/prompt"))).toEqual([]);
    expect(
      requests.filter((request) => request.method !== "GET").map((request) => request.path),
    ).toEqual(["/api/session"]);
    expect(f.owned).toEqual([bound]);
    expect(f.finalize).not.toHaveBeenCalled();
    expect(f.claim).toHaveBeenCalledOnce();
    expect(f.cleanup).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(await realpath(directory)).toBe(directory);
    await expect(adapter.listSessions()).rejects.toThrow(/read unavailable/);
  },
);
afterEach(async () => {
  try {
    expect(ensure).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it("reuses an authenticated compatible service and creates native metadata/model/location/permissions", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  expect((await adapter.create(task, directory)).id).toBe("ses_example");
  const request = requests.find((r) => r.method === "POST");
  expect(request?.body).toMatchObject({
    agent: "build",
    model: { providerID: "test", id: "model-test" },
    location: { directory },
    metadata: {
      battuta: { schema_version: 1, task_id: task.id, worker_id: "worker-1", delegator_role: "tl" },
    },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  });
  expect(request?.authorization).toBe("Basic fake-auth");
  await adapter.close();
});
it("refuses incompatible services before any session write", async () => {
  routes["GET /api/info"] = { version: "2.0.23" };
  await expect(createOpenCodeAdapter(config, deps)).rejects.toThrow(
    /version.*start.*verify.*background service/i,
  );
  expect(requests.some((r) => r.method === "POST")).toBe(false);
});
it("refuses an endpoint that becomes unhealthy during SDK client verification", async () => {
  routes["GET /api/info"] = new Error("private transport detail");
  await expect(createOpenCodeAdapter(config, deps)).rejects.toThrow(
    /start.*verify.*background service/i,
  );
  expect(requests.map((request) => request.path)).toEqual(["/api/info"]);
});
it("refuses an absent service with operator startup instructions and no lifecycle calls", async () => {
  deps.service.discover = () => Promise.resolve(undefined);
  await expect(createOpenCodeAdapter(config, deps)).rejects.toThrow(
    /start.*verify.*background service/i,
  );
  expect(requests).toEqual([]);
});
it("paginates session envelopes using cursor.next without metadata query guesses", async () => {
  routes["GET /api/session?order=asc"] = { data: [], cursor: { next: "next-page" } };
  routes["GET /api/session?order=asc&cursor=next-page"] = routes["GET /api/session"];
  const adapter = await createOpenCodeAdapter(config, deps);
  expect(await adapter.listSessions()).toHaveLength(1);
  expect(requests.filter((r) => r.path.startsWith("/api/session?")).map((r) => r.path)).toEqual([
    "/api/session?order=asc",
    "/api/session?order=asc&cursor=next-page",
  ]);
});
it("admits the exact instruction with deterministic native prompt ID without bypassing policies", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  await adapter.admit(bound, "ses_example");
  const writes = requests.filter((r) => r.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    path: "/api/session/ses_example/prompt",
    authorization: "Basic fake-auth",
    body: {
      id: promptId,
      text: buildPrompt(task),
      delivery: "queue",
      resume: true,
      metadata: {
        battuta: {
          schema_version: 1,
          task_id: task.id,
          worker_id: "worker-1",
          delegator_role: "tl",
        },
      },
    },
  });
});
it("reports configured hard-deny policies without modifying them", async () => {
  routes[
    "GET /api/config?" + new URLSearchParams({ "location[directory]": directory }).toString()
  ] = [
    {
      type: "document",
      info: {
        experimental: { policies: [{ action: "permission", resource: "shell:*", effect: "deny" }] },
      },
    },
  ];
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(/hard-deny/);
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it("selects only the latest final text after admitted input from paginated messages", async () => {
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [
      assistant("old invalid report", 5),
      { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
    ],
    cursor: { next: "more" },
  };
  routes["GET /api/session/ses_example/message?order=asc&cursor=more"] = {
    data: [assistant()],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.initialInputAdmitted).toBe(true);
  expect(snapshot.report).toEqual(report);
  expect(snapshot.permissionsConcern).toBeUndefined();
});
it.each(["active", "inbox", "forms"])(
  "does not parse reports with foreground/pending %s",
  async (kind) => {
    if (kind === "active")
      routes["GET /api/session/active"] = { data: { ses_example: { type: "running" } } };
    if (kind === "inbox")
      routes["GET /api/session/ses_example/inbox"] = {
        data: [
          {
            id: "other",
            sessionID: "ses_example",
            time: { created: 30 },
            type: "user",
            payload: { text: "later" },
            delivery: "queue",
          },
        ],
      };
    if (kind === "forms")
      routes["GET /api/session/ses_example/form"] = {
        data: [
          {
            id: "form_example",
            sessionID: "ses_example",
            title: "Question",
            fields: [{ name: "answer", type: "string" }],
          },
        ],
      };
    const adapter = await createOpenCodeAdapter(config, deps);
    expect((await adapter.inspect(bound)).report).toBeUndefined();
  },
);
it.each(["incomplete", "length", "reasoning", "newer-invalid", "before-input", "no-input"])(
  "rejects unsafe final-report selection: %s",
  async (kind) => {
    const data = [
      { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
      assistant(),
    ];
    if (kind === "incomplete") data[1].time = { created: 20 };
    if (kind === "length") data[1].finish = "length";
    if (kind === "reasoning") data[1].content = [{ type: "reasoning", text: resultBlock }];
    if (kind === "newer-invalid") data.push(assistant("Done without report", 30));
    if (kind === "before-input") data[1] = assistant(resultBlock, 5);
    if (kind === "no-input") data.shift();
    routes["GET /api/session/ses_example/message?order=asc"] = { data, cursor: {} };
    const adapter = await createOpenCodeAdapter(config, deps);
    expect((await adapter.inspect(bound)).report).toBeUndefined();
  },
);
it("runtime succeeded without a report is a blocker", async () => {
  const envelope = routes["GET /api/session/ses_example"] as { data: Record<string, unknown> };
  envelope.data.outcome = "succeeded";
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [{ id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) }],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  expect((await adapter.inspect(bound)).reportError).toMatch(/report/);
});
it("detects binding, ownership, and location mismatches before admission", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.inspect({ ...bound, claimed_by: "other" })).rejects.toThrow(/ownership/);
  await expect(adapter.admit(bound, "ses_other")).rejects.toThrow(/binding/);
  const envelope = routes["GET /api/session/ses_example"] as { data: Record<string, unknown> };
  envelope.data.location = { directory: root };
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.valid).toBe(false);
  expect(snapshot.validationError).toMatch(/location/i);
});
it("bounds uncertain creates and never blindly retries", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  routes["POST /api/session"] = "hang";
  vi.useFakeTimers();
  const result = expect(adapter.create(task, directory)).rejects.toThrow(/uncertain/);
  // Filesystem preflight is real; wait until the HTTP write has reached the boundary.
  await vi.waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
  await vi.advanceTimersByTimeAsync(30001);
  await result;
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("bounds stalled reads without exposing transport secrets", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  routes["GET /api/session?order=asc"] = "hang";
  vi.useFakeTimers();
  const result = expect(adapter.listSessions()).rejects.toThrow(/read unavailable/);
  await vi.advanceTimersByTimeAsync(10001);
  await result;
});
it("rejects repeated pagination cursors instead of looping forever", async () => {
  routes["GET /api/session?order=asc"] = { data: [], cursor: { next: "repeat" } };
  routes["GET /api/session?order=asc&cursor=repeat"] = { data: [], cursor: { next: "repeat" } };
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.listSessions()).rejects.toThrow(/Repeated/);
});
it("rejects missing response envelopes on uncertain creation", async () => {
  const wrapped = routes["POST /api/session"] as { data: unknown };
  routes["POST /api/session"] = wrapped.data;
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.create(task, directory)).rejects.toThrow(/uncertain/);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("records permission requests as blockers, not completion or automatic approvals", async () => {
  routes["GET /api/session/ses_example/permission"] = {
    data: [
      {
        id: "permission_example",
        sessionID: "ses_example",
        action: "shell",
        resources: ["git push"],
      },
    ],
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.pendingPermissions).toHaveLength(1);
  expect(snapshot.report).toBeUndefined();
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it("does not accept an old final report after a newer delivered user input", async () => {
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [
      { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
      assistant(),
      { id: "msg_later", type: "user", time: { created: 30 }, text: "more work" },
    ],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  expect((await adapter.inspect(bound)).report).toBeUndefined();
});
it("refuses ambiguous same-time final assistants", async () => {
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [
      { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) },
      assistant(),
      { ...assistant(), id: "msg_same_time" },
    ],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  expect((await adapter.inspect(bound)).report).toBeUndefined();
});
it("close cancels only local activity and rejects further reads", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  await adapter.close();
  await expect(adapter.listSessions()).rejects.toThrow(/read unavailable/);
  expect(requests.some((r) => r.method !== "GET")).toBe(false);
});
it("streams native events and closes only the subscriber", async () => {
  routes["GET /api/event"] = new Response('data: {"type":"server.connected"}\n\n', {
    headers: { "content-type": "text/event-stream" },
  });
  const adapter = await createOpenCodeAdapter(config, deps);
  const controller = new AbortController();
  const iterator = adapter.events(controller.signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ type: "server.connected" });
  controller.abort();
  await adapter.close();
  expect(requests.find((r) => r.path === "/api/event")?.authorization).toBe("Basic fake-auth");
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it("does not treat a conflicting stable prompt ID as admitted", async () => {
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [
      { id: promptId, type: "user", time: { created: 10 }, text: "another instruction" },
      assistant(),
    ],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.initialInputAdmitted).toBe(false);
  expect(snapshot.report).toBeUndefined();
  expect(snapshot.reportError).toMatch(/identity/);
});
it("recognizes durably queued original input by stable ID without parsing a premature report", async () => {
  routes["GET /api/session/ses_example/message?order=asc"] = { data: [], cursor: {} };
  routes["GET /api/session/ses_example/inbox"] = {
    data: [
      {
        id: promptId,
        sessionID: "ses_example",
        time: { created: 10 },
        type: "user",
        payload: { text: buildPrompt(task) },
        delivery: "queue",
      },
    ],
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.initialInputAdmitted).toBe(true);
  expect(snapshot.pendingInputs).toHaveLength(1);
  expect(snapshot.report).toBeUndefined();
});
it("does not parse a final report while a foreground tool is still running", async () => {
  const message = assistant();
  message.content = [
    { type: "text", text: resultBlock },
    {
      type: "tool",
      id: "call_1",
      name: "shell",
      state: { status: "running", input: {} },
      time: { created: 20 },
    },
  ];
  routes["GET /api/session/ses_example/message?order=asc"] = {
    data: [{ id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task) }, message],
    cursor: {},
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  expect((await adapter.inspect(bound)).report).toBeUndefined();
});
it.each(["permissions", "metadata", "model"])(
  "exposes unsafe returned %s without admitting any input",
  async (kind) => {
    const envelope = routes["GET /api/session/ses_example"] as { data: Record<string, unknown> };
    if (kind === "permissions")
      envelope.data.permissions = [{ action: "*", resource: "*", effect: "ask" }];
    if (kind === "metadata") envelope.data.metadata = { battuta: { task_id: "another" } };
    if (kind === "model") envelope.data.model = { id: "different", providerID: "test" };
    const adapter = await createOpenCodeAdapter(config, deps);
    const snapshot = await adapter.inspect(bound);
    if (kind === "permissions") expect(snapshot.permissionsConcern).toMatch(/not unrestricted/);
    else expect(snapshot.valid).toBe(false);
    await expect(adapter.admit(bound, "ses_example")).rejects.toThrow();
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  },
);
it("uses only SDK discovery with the isolated registration path", async () => {
  deps.service.discover = (options) => {
    expect(options?.file).toBe(join(root, "service.json"));
    return Promise.resolve({ url: "http://fake", auth: undefined });
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  await adapter.listSessions();
  await adapter.close();
});
it.each(["unhealthy", "incompatible", "malformed"])(
  "preserves existing %s registration without ensure/recovery",
  async (state) => {
    await writeFile(join(root, "service.json"), state);
    deps.service.discover = () => Promise.resolve(undefined);
    await expect(createOpenCodeAdapter(config, deps)).rejects.toThrow(
      /start.*verify.*background service/i,
    );
    expect(requests).toEqual([]);
    expect(await readFile(join(root, "service.json"), "utf8")).toBe(state);
  },
);
it("delegates the production registration default to SDK discovery", async () => {
  delete deps.serviceFile;
  deps.service.discover = (options) => {
    expect(options?.file).toBeUndefined();
    return Promise.resolve({ url: "http://fake", auth: undefined });
  };
  await createOpenCodeAdapter(config, deps);
});
it.each(["resolve", "absent", "reject"])(
  "discovery timeout leaves only a read pending; late %s never starts activity",
  async (outcome) => {
    let settle: () => void = () => {};
    const discover = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof Service.discover>>>((resolve, reject) => {
          settle = () =>
            outcome === "reject"
              ? reject(new Error("late lookup failed"))
              : resolve(outcome === "absent" ? undefined : { url: "http://fake", auth: undefined });
        }),
    );
    deps.service.discover = discover;
    vi.useFakeTimers();
    const result = createOpenCodeAdapter(config, deps).then(
      () => "unexpected success",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10001);
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected discovery timeout error");
    expect(error.message).toMatch(/start.*verify.*background service/i);
    settle();
    await vi.advanceTimersByTimeAsync(30000);
    expect(discover).toHaveBeenCalledOnce();
    expect(requests).toEqual([]);
  },
);
it("surfaces SDK discovery errors without native fallback or credential details", async () => {
  deps.service.discover = () => Promise.reject(new Error("private credential detail"));
  await expect(createOpenCodeAdapter(config, deps)).rejects.toThrow(
    /start.*verify.*background service/i,
  );
  expect(requests).toEqual([]);
});
it("bounds uncertain admission without retries or changing IDs", async () => {
  routes["POST /api/session/ses_example/prompt"] = "hang";
  const adapter = await createOpenCodeAdapter(config, deps);
  vi.useFakeTimers();
  const result = expect(adapter.admit(bound, "ses_example")).rejects.toThrow(/uncertain/);
  await vi.waitFor(() => expect(requests.some((r) => r.path.endsWith("/prompt"))).toBe(true));
  await vi.advanceTimersByTimeAsync(30001);
  await result;
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ id: promptId });
});
it("aborting an in-flight prompt preserves uncertainty without any native cancellation", async () => {
  routes["POST /api/session/ses_example/prompt"] = "hang";
  const adapter = await createOpenCodeAdapter(config, deps);
  const controller = new AbortController();
  const result = expect(adapter.admit(bound, "ses_example", controller.signal)).rejects.toThrow(
    /write uncertain/,
  );
  await vi.waitFor(() =>
    expect(requests.some((request) => request.path.endsWith("/prompt"))).toBe(true),
  );
  controller.abort();
  await result;
  expect(
    requests.filter((request) => request.method !== "GET").map((request) => request.path),
  ).toEqual(["/api/session/ses_example/prompt"]);
  expect(requests.find((request) => request.path.endsWith("/prompt"))?.signal?.aborted).toBe(true);
  await adapter.close();
});
it.each(["list", "create", "inspect"])(
  "bounds %s local HTTP activity with the caller shutdown signal",
  async (kind) => {
    const key =
      kind === "list"
        ? "GET /api/session?order=asc"
        : kind === "create"
          ? "POST /api/session"
          : "GET /api/session/ses_example";
    routes[key] = "hang";
    const adapter = await createOpenCodeAdapter(config, deps);
    const controller = new AbortController();
    const operation =
      kind === "list"
        ? adapter.listSessions(controller.signal)
        : kind === "create"
          ? adapter.create(task, directory, controller.signal)
          : adapter.inspect(bound, controller.signal);
    const result = expect(operation).rejects.toThrow(
      kind === "create" ? /write uncertain/ : /read unavailable/,
    );
    await vi.waitFor(() =>
      expect(requests.some((request) => `${request.method} ${request.path}` === key)).toBe(true),
    );
    controller.abort();
    try {
      expect(
        requests.find((request) => `${request.method} ${request.path}` === key)?.signal?.aborted,
      ).toBe(true);
    } finally {
      await adapter.close();
      await result;
    }
  },
);
it.each([
  "transport",
  "wrong-id",
  "missing-envelope",
  "wrong-payload",
  "wrong-metadata",
  "wrong-session",
  "wrong-type",
  "wrong-delivery",
])("treats %s admission outcome as uncertain, never retries", async (kind) => {
  if (kind === "transport")
    routes["POST /api/session/ses_example/prompt"] = new Error("secret transport detail");
  if (kind === "wrong-id")
    routes["POST /api/session/ses_example/prompt"] = {
      data: { id: "msg_other", sessionID: "ses_example" },
    };
  if (kind === "missing-envelope") routes["POST /api/session/ses_example/prompt"] = {};
  if (kind === "wrong-payload")
    routes["POST /api/session/ses_example/prompt"] = {
      data: {
        id: promptId,
        sessionID: "ses_example",
        type: "user",
        payload: { text: "conflicting prompt" },
        delivery: "queue",
      },
    };
  if (["wrong-metadata", "wrong-session", "wrong-type", "wrong-delivery"].includes(kind)) {
    const response = routes["POST /api/session/ses_example/prompt"] as {
      data: Record<string, unknown>;
    };
    if (kind === "wrong-metadata")
      response.data.payload = {
        text: buildPrompt(task),
        metadata: { battuta: { task_id: "another" } },
      };
    if (kind === "wrong-session") response.data.sessionID = "ses_other";
    if (kind === "wrong-type") response.data.type = "synthetic";
    if (kind === "wrong-delivery") response.data.delivery = "steer";
  }
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(/uncertain/);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("does not auto-approve pending permission requests before admission", async () => {
  routes["GET /api/session/ses_example/permission"] = {
    data: [
      {
        id: "permission_pending",
        sessionID: "ses_example",
        action: "shell",
        resources: ["sudo command"],
      },
    ],
  };
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(
    /permission.*pending|pending.*permission/,
  );
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it.each(
  [
    {},
    { data: [] },
    [{ type: "unsupported" }],
    [{ type: "document", info: { permissions: "unsupported" } }],
    [{ type: "document", info: { experimental: { policies: "unsupported" } } }],
  ].map((response) => [response]),
)("blocks unsupported configuration response %j", async (response) => {
  routes[
    "GET /api/config?" + new URLSearchParams({ "location[directory]": directory }).toString()
  ] = response;
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(
    /configuration.*unavailable|unsupported/i,
  );
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it.each(["ask", "deny"])(
  "reports observed authored %s rules without changing them",
  async (effect) => {
    routes[
      "GET /api/config?" + new URLSearchParams({ "location[directory]": directory }).toString()
    ] = [{ type: "document", info: { permissions: [{ action: "shell", resource: "*", effect }] } }];
    const adapter = await createOpenCodeAdapter(config, deps);
    await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(
      /observed.*ask|observed.*deny/i,
    );
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  },
);
it("reuses the same deterministic payload for explicit repeated admissions, never inventing a new ID", async () => {
  const adapter = await createOpenCodeAdapter(config, deps);
  await adapter.admit(bound, "ses_example");
  await adapter.admit(bound, "ses_example");
  const writes = requests.filter((r) => r.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[0].body).toEqual(writes[1].body);
  expect(writes[1].body).toMatchObject({ id: promptId });
});
it.each(
  [
    undefined,
    [],
    [{ action: "*", resource: "*", effect: "deny" }],
    [{ action: "*", resource: "*", effect: "allow", extra: true }],
    [
      { action: "*", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "allow" },
    ],
  ].map((permissions) => [permissions]),
)("refuses nonexact returned creation permissions %j", async (permissions) => {
  const envelope = routes["POST /api/session"] as { data: Record<string, unknown> };
  envelope.data.permissions = permissions;
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.create(task, directory)).rejects.toThrow(
    /uncertain.*permission|permission.*uncertain/i,
  );
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it("accepts supported config entries with wildcard authored allows and non-permission provider policies", async () => {
  routes[
    "GET /api/config?" + new URLSearchParams({ "location[directory]": directory }).toString()
  ] = [
    { type: "directory", path: root },
    {
      type: "document",
      info: {
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: { build: { permissions: [] } },
        experimental: {
          policies: [{ action: "provider.use", resource: "unused", effect: "deny" }],
        },
      },
    },
  ];
  const adapter = await createOpenCodeAdapter(config, deps);
  await adapter.admit(bound, "ses_example");
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
it.each(["active", "inbox", "forms", "permissions"])(
  "blocks malformed native %s inspection rather than finalizing",
  async (kind) => {
    if (kind === "active") routes["GET /api/session/active"] = { data: null };
    if (kind === "inbox") routes["GET /api/session/ses_example/inbox"] = { data: {} };
    if (kind === "forms") routes["GET /api/session/ses_example/form"] = { data: {} };
    if (kind === "permissions") routes["GET /api/session/ses_example/permission"] = { data: {} };
    const adapter = await createOpenCodeAdapter(config, deps);
    await expect(adapter.inspect(bound)).rejects.toThrow(/unsupported.*state/i);
  },
);
it("blocks malformed pending permission response before any prompt write", async () => {
  routes["GET /api/session/ses_example/permission"] = { data: {} };
  const adapter = await createOpenCodeAdapter(config, deps);
  await expect(adapter.admit(bound, "ses_example")).rejects.toThrow(
    /Unsupported native pending permission/,
  );
  expect(requests.every((r) => r.method === "GET")).toBe(true);
});
it.each(["history-metadata", "inbox-metadata", "inbox-delivery"])(
  "refuses conflicting durable %s evidence",
  async (kind) => {
    if (kind === "history-metadata") {
      routes["GET /api/session/ses_example/message?order=asc"] = {
        data: [
          {
            id: promptId,
            type: "user",
            time: { created: 10 },
            text: buildPrompt(task),
            metadata: { battuta: { task_id: "other" } },
          },
          assistant(),
        ],
        cursor: {},
      };
    } else {
      routes["GET /api/session/ses_example/inbox"] = {
        data: [
          {
            id: promptId,
            type: "user",
            sessionID: "ses_example",
            delivery: kind === "inbox-delivery" ? "steer" : "queue",
            payload: {
              text: buildPrompt(task),
              ...(kind === "inbox-metadata" ? { metadata: { battuta: { task_id: "other" } } } : {}),
            },
          },
        ],
      };
    }
    const adapter = await createOpenCodeAdapter(config, deps);
    const snapshot = await adapter.inspect(bound);
    expect(snapshot.initialInputAdmitted).toBe(false);
    expect(snapshot.report).toBeUndefined();
    expect(snapshot.reportError).toMatch(/identity.*ambiguous/);
  },
);
it.each(["history", "inbox"])("accepts matching optional durable %s metadata", async (kind) => {
  const metadata = {
    battuta: { schema_version: 1, task_id: task.id, worker_id: "worker-1", delegator_role: "tl" },
  };
  if (kind === "history") {
    routes["GET /api/session/ses_example/message?order=asc"] = {
      data: [
        { id: promptId, type: "user", time: { created: 10 }, text: buildPrompt(task), metadata },
        assistant(),
      ],
      cursor: {},
    };
  } else {
    routes["GET /api/session/ses_example/inbox"] = {
      data: [
        {
          id: promptId,
          type: "user",
          sessionID: "ses_example",
          delivery: "queue",
          payload: { text: buildPrompt(task), metadata },
        },
      ],
    };
  }
  const adapter = await createOpenCodeAdapter(config, deps);
  const snapshot = await adapter.inspect(bound);
  expect(snapshot.initialInputAdmitted).toBe(true);
  expect(snapshot.reportError).toBeUndefined();
  if (kind === "history") expect(snapshot.report).toEqual(report);
});
