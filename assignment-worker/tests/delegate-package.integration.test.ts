import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseClaudeArgs } from "../claude-proxy.ts";
import { connectChannel, openChannel, type ProxyMessage } from "../delegate-channel.ts";
import { registerProjectDelegate } from "../project-delegate.ts";
import { createProjectsFixture, type ProjectsFixture } from "./project-fixture.ts";

// The real pi-harness-delegate, as worker setup installs it into the source worker profile.
const profileDir = fileURLToPath(new URL("../../bots/worker/.pi", import.meta.url));
const packageDir = join(profileDir, "npm/node_modules/pi-harness-delegate");
const installed = existsSync(join(packageDir, "extensions/index.ts"));
const stubProxy = join(dirname(fileURLToPath(import.meta.url)), "stub-proxy.ts");

let fixture: ProjectsFixture;
let agentDir: string;
beforeEach(async () => {
  fixture = await createProjectsFixture();
  agentDir = await fs.mkdtemp(join(tmpdir(), "delegate-agent-"));
  // The package keeps its config, run records and transcripts under the agent dir.
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.dispose();
  await fs.rm(agentDir, { recursive: true, force: true });
});

describe.skipIf(!installed)(
  "the installed pi-harness-delegate (run worker setup to install it)",
  () => {
    test("HARNESSES.claude has binary and buildArgs, and buildArgs emits only arguments parseClaudeArgs accepts", async () => {
      const { createJiti } = await import("jiti");
      const registry = await createJiti(import.meta.url).import<{
        HARNESSES: { claude: { binary: string; buildArgs(opts: object): string[] } };
      }>(join(packageDir, "extensions/harnesses/registry.ts"));
      const { claude } = registry.HARNESSES;
      expect(typeof claude.binary).toBe("string");
      for (const opts of [
        {
          prompt: "p",
          cwd: "/w",
          permission: "edit",
          model: "claude-haiku-5-5",
          maxBudgetUsd: 2,
          addDirs: ["/a", "/b"],
          resumeSessionId: "s-1",
        },
        { prompt: "p", cwd: "/w", permission: "readonly", sessionPersistence: false },
      ])
        expect(() => parseClaudeArgs(claude.buildArgs(opts))).not.toThrow();
    });

    test("a run asks a question, the worker answers, and the package returns the answer as the result", async () => {
      const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
      const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
      const sendMessage = vi.fn();
      const pi = new Proxy(
        {
          registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool),
          on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) =>
            handlers.set(event, [...(handlers.get(event) ?? []), handler]),
          sendMessage,
          appendEntry: vi.fn(),
        },
        {
          get: (target, property) =>
            property in target ? target[property as keyof typeof target] : () => undefined,
        },
      ) as unknown as ExtensionAPI;
      await registerProjectDelegate(pi, {
        profileDir,
        projectsRoot: fixture.projectsRoot,
        proxyPath: stubProxy,
        log: (message) => {
          throw new Error(message);
        },
      });
      const ctx = {
        cwd: "/worker/bot",
        hasUI: false,
        ui: {},
        sessionManager: {
          getSessionFile: () => "/sessions/one.jsonl",
          getEntries: () => [
            {
              type: "custom",
              customType: "assignment-binding",
              data: {
                project: "atlas",
                assignment_id: "0123abcd",
                claimed_at: "2026-11-19T10:00:00Z",
              },
            },
          ],
        },
      } as unknown as ExtensionContext;
      for (const handler of handlers.get("session_start") ?? [])
        await handler({ reason: "startup" }, ctx);
      try {
        await tools
          .get("delegate")!
          .execute("id", { task: "say hi", mode: "general" }, undefined, vi.fn(), ctx);
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ customType: "delegate-request" }),
            { triggerTurn: true },
          ),
        );
        await tools
          .get("delegate_reply")!
          .execute("id", { requestId: "q-1", text: "the work folder" }, undefined, vi.fn(), ctx);
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              customType: "delegate-run",
              content: expect.stringContaining("answered: the work folder") as string,
            }),
            { triggerTurn: true },
          ),
        );
      } finally {
        for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
      }
    });
  },
);

test("two workers each receive only their own proxy's messages", async () => {
  const received: Record<string, ProxyMessage[]> = { one: [], two: [] };
  const servers = await Promise.all(
    (["one", "two"] as const).map((name) =>
      openChannel({ onMessage: (message) => received[name].push(message), onDisconnect: () => {} }),
    ),
  );
  try {
    servers[0].expect("token-one");
    servers[1].expect("token-two");
    const one = await connectChannel(servers[0].path, "token-one");
    const two = await connectChannel(servers[1].path, "token-two");
    one.send({ type: "started", sessionId: "s-one" });
    two.send({ type: "started", sessionId: "s-two" });
    await vi.waitFor(() => {
      expect(received.one).toEqual([{ type: "started", sessionId: "s-one" }]);
      expect(received.two).toEqual([{ type: "started", sessionId: "s-two" }]);
    });
    const crossed = await connectChannel(servers[0].path, "token-two");
    await new Promise<void>((resolve) => crossed.onClose(resolve));
    one.close();
    two.close();
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});
