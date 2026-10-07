import { createTaskConnection } from "../task-delegation/auth.ts";
import { loadConfig } from "./config.ts";
import { acquireDaemonLock } from "./lock.ts";
import { createOpenCodeAdapter } from "./opencode.ts";
import { runDaemon, verifyAuthority, type DaemonOptions } from "./daemon.ts";
import { prepareWorktree } from "./worktree.ts";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export interface MainDependencies {
  loadConfig: typeof loadConfig;
  acquireLock: typeof acquireDaemonLock;
  connect: typeof createTaskConnection;
  openCode: typeof createOpenCodeAdapter;
  run: typeof runDaemon;
  listen: (callback: () => void) => () => void;
  log: (kind: string, detail: string) => void;
}
const defaults: MainDependencies = {
  loadConfig,
  acquireLock: acquireDaemonLock,
  connect: createTaskConnection,
  openCode: createOpenCodeAdapter,
  run: runDaemon,
  listen: (callback) => {
    process.on("SIGINT", callback);
    process.on("SIGTERM", callback);
    return () => {
      process.off("SIGINT", callback);
      process.off("SIGTERM", callback);
    };
  },
  log: (kind, detail) => console.error(`${kind}: ${detail}`),
};
export function queueSubscriber(
  connection: Awaited<ReturnType<typeof createTaskConnection>>,
): DaemonOptions["subscribeQueue"] {
  return (projects, wake, signal) => {
    const channels = projects.map((project) =>
      connection.supabase
        .channel(`task-pool:${project}`, { config: { private: true } })
        .on("broadcast", { event: "queued" }, wake)
        .subscribe(() => wake()),
    );
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= Promise.all(
        channels.map((channel) => connection.supabase.removeChannel(channel)),
      ).then(() => undefined));
    const abort = () => {
      void close().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return Promise.resolve(async () => {
      signal.removeEventListener("abort", abort);
      await close();
    });
  };
}
export async function main(
  args: string[],
  env: NodeJS.ProcessEnv,
  dependencies: MainDependencies = defaults,
): Promise<void> {
  if (args.length !== 2 || args[0] !== "--config" || !isAbsolute(args[1]))
    throw new Error("Usage: node worker-daemon/main.ts --config /absolute/config.json");
  const required = (key: string) => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`Missing ${key}`);
    return value;
  };
  const auth = {
    url: required("SUPABASE_URL"),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
    email: required("TASK_AUTH_EMAIL"),
    password: required("TASK_AUTH_PASSWORD"),
  };
  const config = await dependencies.loadConfig(args[1]);
  const release = await dependencies.acquireLock(config.lockPath);
  const controller = new AbortController();
  let unlisten: (() => void) | undefined;
  let connection: Awaited<ReturnType<typeof createTaskConnection>> | undefined;
  let opencode: Awaited<ReturnType<typeof createOpenCodeAdapter>> | undefined;
  try {
    unlisten = dependencies.listen(() => controller.abort());
    connection = await dependencies.connect(auth);
    verifyAuthority(config, connection.principal);
    if (controller.signal.aborted) return;
    opencode = await dependencies.openCode(config);
    if (controller.signal.aborted) return;
    await dependencies.run(
      {
        config,
        tasks: connection,
        opencode,
        prepareWorktree,
        subscribeQueue: queueSubscriber(connection),
        log: dependencies.log,
      },
      controller.signal,
    );
  } finally {
    controller.abort();
    unlisten?.();
    try {
      await opencode?.close();
    } finally {
      try {
        await connection?.close();
      } finally {
        await release();
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2), process.env).catch(() => {
    console.error(
      "Worker daemon stopped: check configuration and signed worker authority. Before launching with --config /absolute/config.json, start and verify OpenCode 2.0.24 using opencode service start / opencode service status. Retained tasks require inspection; daemon never starts or repairs the service.",
    );
    process.exitCode = 1;
  });
}
