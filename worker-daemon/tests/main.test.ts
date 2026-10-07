import { expect, it, vi } from "vitest";
import { main, queueSubscriber, type MainDependencies } from "../main.ts";
import { task } from "./fixtures.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

function fixture() {
  const order: string[] = [];
  const release = vi.fn(() => {
    order.push("release");
    return Promise.resolve();
  });
  const close = vi.fn(() => {
    order.push("auth-close");
    return Promise.resolve();
  });
  const serverClose = vi.fn(() => Promise.resolve());
  const deps = {
    loadConfig: vi.fn(() =>
      Promise.resolve({
        workerId: "worker-1",
        projects: { [task.project]: { checkout: "/repo", baseRef: "HEAD" } },
        worktreeRoot: "/work",
        lockPath: "/lock",
        capacity: 1,
        reconcileMs: 1000,
      }),
    ),
    acquireLock: vi.fn(() => {
      order.push("lock");
      return Promise.resolve(release);
    }),
    connect: vi.fn(() => {
      order.push("auth");
      return Promise.resolve({
        principal: { role: "worker", worker_id: "worker-1", projects: [task.project] },
        close,
        client: {},
        supabase: {},
      });
    }),
    openCode: vi.fn(() => {
      order.push("discover");
      return Promise.resolve({ close: serverClose });
    }),
    run: vi.fn(() => {
      order.push("run");
      return Promise.resolve();
    }),
    listen: vi.fn(() => vi.fn()),
    log: vi.fn(),
  } as unknown as MainDependencies;
  return { deps, order, release, close, serverClose };
}
const env = {
  SUPABASE_URL: "http://local",
  SUPABASE_PUBLISHABLE_KEY: "public",
  TASK_AUTH_EMAIL: "worker@example.test",
  TASK_AUTH_PASSWORD: "secret",
};
it("locks, authenticates and discovers existing service before running; cleans owned resources", async () => {
  const f = fixture();
  await main(["--config", "/config.json"], env, f.deps);
  expect(f.order).toEqual(["lock", "auth", "discover", "run", "auth-close", "release"]);
  expect(f.deps.connect).toHaveBeenCalledWith({
    url: "http://local",
    publishableKey: "public",
    email: "worker@example.test",
    password: "secret",
  });
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.serverClose).toHaveBeenCalledOnce();
});
it("missing service prevents running and releases auth and lock", async () => {
  const f = fixture();
  vi.mocked(f.deps.openCode).mockRejectedValue(new Error("Start existing service"));
  await expect(main(["--config", "/config.json"], env, f.deps)).rejects.toThrow(/existing service/);
  expect(f.deps.run).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
it("checks all project authority before service discovery or claims", async () => {
  const f = fixture();
  vi.mocked(f.deps.connect).mockResolvedValue({
    principal: { role: "worker", worker_id: "wrong", projects: [] },
    close: f.close,
  } as unknown as Awaited<ReturnType<MainDependencies["connect"]>>);
  await expect(main(["--config", "/config.json"], env, f.deps)).rejects.toThrow(/authority/);
  expect(f.deps.openCode).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
it("rejects even one unauthorized mapping while other projects are authorized", async () => {
  const f = fixture();
  const config = await f.deps.loadConfig("/config.json");
  config.projects["Unauthorized"] = { checkout: "/second", baseRef: "HEAD" };
  vi.mocked(f.deps.loadConfig).mockResolvedValue(config);
  await expect(main(["--config", "/config.json"], env, f.deps)).rejects.toThrow(/authority/);
  expect(f.deps.openCode).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});
it.each(
  [[], ["--config", "relative.json"], ["--config", "/ok", "extra"]].map((args) => ({ args })),
)("rejects invalid CLI before side effects: $args", async ({ args }) => {
  const f = fixture();
  await expect(main(args, env, f.deps)).rejects.toThrow(/Usage/);
  expect(f.deps.acquireLock).not.toHaveBeenCalled();
});
it("rejects missing credentials without exposing values", async () => {
  const f = fixture();
  await expect(
    main(["--config", "/config.json"], { TASK_AUTH_PASSWORD: "secret" }, f.deps),
  ).rejects.toThrow(/Missing/);
  expect(f.deps.connect).not.toHaveBeenCalled();
});
it("loads CLI with native erasable Node TypeScript without contacting services", async () => {
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", "import './main.ts'"],
    { cwd: new URL("..", import.meta.url) },
  );
  expect(result.stderr).toBe("");
});
it("signal during discovery stops before daemon admission and cleans listeners and refresh", async () => {
  const f = fixture();
  let shutdown!: () => void;
  const unlisten = vi.fn();
  f.deps.listen = (callback) => {
    shutdown = callback;
    return unlisten;
  };
  const discover = f.deps.openCode;
  vi.mocked(discover).mockImplementation(() => {
    shutdown();
    return Promise.resolve({ close: f.serverClose } as unknown as Awaited<
      ReturnType<typeof discover>
    >);
  });
  await main(["--config", "/config.json"], env, f.deps);
  expect(f.deps.run).not.toHaveBeenCalled();
  expect(unlisten).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
it("run/close failure still removes signal listeners and releases owned lock", async () => {
  const f = fixture();
  const unlisten = vi.fn();
  f.deps.listen = () => unlisten;
  vi.mocked(f.deps.run).mockRejectedValue(new Error("loop failed"));
  f.close.mockRejectedValue(new Error("refresh close failed"));
  await expect(main(["--config", "/config.json"], env, f.deps)).rejects.toThrow(/close failed/);
  expect(unlisten).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
it("failure installing shutdown listener still releases acquired lock", async () => {
  const f = fixture();
  f.deps.listen = () => {
    throw new Error("listener failed");
  };
  await expect(main(["--config", "/config.json"], env, f.deps)).rejects.toThrow(/listener failed/);
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.deps.connect).not.toHaveBeenCalled();
});
it("native CLI refusal provides service operator guidance without contacting services", async () => {
  const result = await promisify(execFile)(process.execPath, ["main.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {},
  }).catch((error: unknown) => {
    if (!error || typeof error !== "object" || !("stderr" in error) || !("code" in error))
      throw error;
    return { stderr: error.stderr, code: error.code };
  });
  expect(result).toHaveProperty("code", 1);
  expect(result.stderr).toContain("opencode service start");
  expect(result.stderr).toContain("opencode service status");
});
it("subscribes only private compatible queued broadcasts and wakes on reconnect; abort removes channels once", async () => {
  const subscriptions: {
    name: string;
    settings: unknown;
    event?: unknown;
    broadcast?: () => void;
    status?: () => void;
  }[] = [];
  const removed: unknown[] = [];
  const supabase = {
    channel: (name: string, settings: unknown) => {
      const entry: (typeof subscriptions)[number] = { name, settings };
      subscriptions.push(entry);
      const channel = {
        on: (_type: string, event: unknown, callback: () => void) => {
          entry.event = event;
          entry.broadcast = callback;
          return channel;
        },
        subscribe: (callback: () => void) => {
          entry.status = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: (channel: unknown) => {
      removed.push(channel);
      return Promise.resolve("ok");
    },
  };
  const subscribe = queueSubscriber({ supabase } as unknown as Awaited<
    ReturnType<MainDependencies["connect"]>
  >);
  const wake = vi.fn();
  const controller = new AbortController();
  const close = await subscribe(["First", "Second"], wake, controller.signal);
  expect(subscriptions.map(({ name, settings, event }) => ({ name, settings, event }))).toEqual([
    {
      name: "task-pool:First",
      settings: { config: { private: true } },
      event: { event: "queued" },
    },
    {
      name: "task-pool:Second",
      settings: { config: { private: true } },
      event: { event: "queued" },
    },
  ]);
  subscriptions[0].broadcast!();
  subscriptions[0].status!();
  subscriptions[0].status!();
  expect(wake).toHaveBeenCalledTimes(3);
  controller.abort();
  await close();
  await close();
  expect(removed).toHaveLength(2);
});
