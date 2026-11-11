import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreparedRecall } from "../recall-agent.ts";
import { CaptureQueue } from "../capture-queue.ts";
import { record } from "./fixtures/record.ts";

const run = vi.hoisted(() => vi.fn<typeof import("../recall-agent.ts").runRecallAgent>());
vi.mock("../recall-agent.ts", async (original) => ({
  ...(await original<typeof import("../recall-agent.ts")>()),
  runRecallAgent: run,
}));
import extension from "../index.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  run.mockReset();
});

const prepared = (status: PreparedRecall["status"] = "ready"): PreparedRecall => ({
  status,
  context: status === "unavailable" ? "Memory unavailable" : "qualified synthetic evidence",
  validationEvidence: [],
  currentRefs: [],
  preparedAt: new Date().toISOString(),
});

function userEvent(prompt: string) {
  return {
    messageType: "user" as const,
    prompt,
    systemPromptOptions: { sections: {} as Record<string, string> },
  };
}
function customEvent(customType: string, content: string) {
  return {
    messageType: "custom" as const,
    message: { customType, content },
    systemPromptOptions: { sections: {} },
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "recall-hook-"));
  let sessionId = "first";
  vi.stubEnv("AGENT_ROLE", "cos");
  vi.stubEnv("BATTUTA_MEMORY_DATA_DIR", dir);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, ".pi"));
  await mkdir(join(dir, ".pi"));
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({ battutaMemoryCapture: { enabled: false } }),
  );
  await writeFile(join(dir, "ME.md"), "Initial owner profile");
  const hooks = new Map<string, (...args: unknown[]) => unknown>();
  extension({
    on: (name: string, fn: (...args: unknown[]) => unknown) => hooks.set(name, fn),
    appendEntry: () => {},
  } as unknown as ExtensionAPI);
  const ctx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => [],
      buildContextEntries: () => [],
    },
    ui: { setStatus: () => {} },
  } as unknown as ExtensionContext;
  const startSession = () => hooks.get("session_start")!({}, ctx);
  return {
    dir,
    hooks,
    ctx,
    startSession,
    switchTo: (next: string) => {
      sessionId = next;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("compaction refreshes the profile snapshot for ongoing and later model contexts", async () => {
  const f = await fixture();
  run.mockResolvedValue(prepared());
  try {
    await f.startSession();
    const first = userEvent("first");
    await f.hooks.get("before_agent_start")!(first, f.ctx);
    expect(first.systemPromptOptions.sections["owner-profile"]).toContain("Initial owner profile");

    await writeFile(join(f.dir, "ME.md"), "Changed between messages");
    const second = userEvent("second");
    await f.hooks.get("before_agent_start")!(second, f.ctx);
    expect(second.systemPromptOptions.sections["owner-profile"]).toContain("Initial owner profile");
    expect(second.systemPromptOptions.sections["owner-profile"]).not.toContain("Changed between");

    await f.hooks.get("session_compact")!({}, f.ctx);
    const ongoing = (await f.hooks.get("context_with_system")!(
      {
        messages: [
          { role: "system", content: "existing system context" },
          { role: "user", content: "compaction continuation" },
        ],
      },
      f.ctx,
    )) as { messages: { role: string; content: string }[] };
    expect(
      ongoing.messages.some(
        (message) =>
          message.role === "system" && message.content.includes("Changed between messages"),
      ),
    ).toBe(true);

    const afterCompact = userEvent("later run");
    await f.hooks.get("before_agent_start")!(afterCompact, f.ctx);
    expect(afterCompact.systemPromptOptions.sections["owner-profile"]).toContain(
      "Changed between messages",
    );

    await writeFile(join(f.dir, "ME.md"), "New session profile");
    await f.hooks.get("session_before_switch")!({}, f.ctx);
    f.switchTo("second");
    await f.startSession();
    const afterSwitch = userEvent("fourth");
    await f.hooks.get("before_agent_start")!(afterSwitch, f.ctx);
    expect(afterSwitch.systemPromptOptions.sections["owner-profile"]).toContain(
      "New session profile",
    );
  } finally {
    await f.close();
  }
});

test("a retained synthetic capture neither suppresses the profile snapshot nor gates usable recall", async () => {
  const f = await fixture();
  run.mockResolvedValue(prepared());
  try {
    await f.startSession();
    const queue = await CaptureQueue.open(join(f.dir, "capture-queue/cos"), "cos");
    await queue.track("earlier", [], false);
    await queue.track(
      "earlier",
      [{ id: "e", type: "message", message: { role: "user", content: "synthetic correction" } }],
      true,
    );

    const event = userEvent("question");
    const result = (await f.hooks.get("before_agent_start")!(event, f.ctx)) as {
      message: { content: string };
    };
    expect(event.systemPromptOptions.sections["owner-profile"]).toContain("Initial owner profile");
    expect(run.mock.calls[0]?.[2]).not.toHaveProperty("capturePending");
    expect(result.message.content).toContain("memory-context:ready");
    expect(result.message.content).toContain("qualified synthetic evidence");
  } finally {
    await f.close();
  }
});

test("every main CoS start prepares recall before a user, Agent Mail, or other custom reply", async () => {
  const f = await fixture();
  run.mockResolvedValue(prepared());
  try {
    await f.startSession();
    await f.hooks.get("before_agent_start")!(userEvent("hello"), f.ctx);
    await f.hooks.get("before_agent_start")!(customEvent("agent-mail", "mail update"), f.ctx);
    await f.hooks.get("before_agent_start")!(
      customEvent("scheduled-owner-update", "scheduled update"),
      f.ctx,
    );
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map((call) => call[0].current)).toEqual([
      "hello",
      "mail update",
      "scheduled update",
    ]);

    await expect(
      f.hooks.get("before_agent_start")!(customEvent("memory-context", "internal"), f.ctx),
    ).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
  } finally {
    await f.close();
  }
});

test.each([
  ["user", () => userEvent("delayed question")],
  ["Agent Mail", () => customEvent("agent-mail", "delayed mail")],
])("%s preparation cannot resolve before its awaited recall outcome", async (_origin, eventFor) => {
  const f = await fixture();
  let finish!: (value: PreparedRecall) => void;
  run.mockImplementation(
    () =>
      new Promise<PreparedRecall>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await f.startSession();
    let settled = false;
    const pending = Promise.resolve(f.hooks.get("before_agent_start")!(eventFor(), f.ctx)).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finish(prepared());
    const result = (await pending) as { message: { content: string } };
    expect(result.message.content).toContain("memory-context:ready");
  } finally {
    await f.close();
  }
});

test("expired evidence and obsolete packets are filtered without changing the profile snapshot", async () => {
  const f = await fixture();
  const expired = record();
  expired.memory_metadata!.expires_at = new Date(Date.now() + 60_000).toISOString();
  const current = record("b".repeat(64));
  run
    .mockResolvedValueOnce({
      ...prepared(),
      context: "soon expired evidence",
      validationEvidence: [expired],
      currentRefs: [expired.ref],
    })
    .mockResolvedValueOnce({
      ...prepared(),
      context: "current evidence",
      validationEvidence: [current],
      currentRefs: [current.ref],
    });
  try {
    await f.startSession();
    const first = (await f.hooks.get("before_agent_start")!(userEvent("first"), f.ctx)) as {
      message: { content: string; details: unknown };
    };
    const secondEvent = userEvent("second");
    const second = (await f.hooks.get("before_agent_start")!(secondEvent, f.ctx)) as {
      message: { content: string; details: unknown };
    };
    const filtered = (await f.hooks.get("context")!(
      {
        messages: [
          { role: "custom", ...first.message },
          { role: "custom", ...second.message },
        ],
      },
      f.ctx,
    )) as { messages: { content: string }[] };
    expect(filtered.messages).toEqual([
      { role: "custom", ...second.message, content: "memory-context:ready\ncurrent evidence" },
    ]);
    expect(secondEvent.systemPromptOptions.sections["owner-profile"]).toContain(
      "Initial owner profile",
    );

    run.mockResolvedValueOnce({
      ...prepared(),
      context: "soon expired evidence",
      validationEvidence: [expired],
      currentRefs: [expired.ref],
    });
    const third = (await f.hooks.get("before_agent_start")!(userEvent("third"), f.ctx)) as {
      message: { content: string; details: unknown };
    };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(expired.memory_metadata!.expires_at) + 1);
    const expiredOnly = (await f.hooks.get("context")!(
      { messages: [{ role: "custom", ...third.message }] },
      f.ctx,
    )) as { messages: { content: string }[] };
    expect(expiredOnly.messages[0]?.content).toContain("memory-context:unavailable");
  } finally {
    await f.close();
  }
});

test.each(["missing", "oversized", "credential"])(
  "%s profile refresh remains independent from usable recall and redacts sensitive text",
  async (condition) => {
    const f = await fixture();
    run.mockResolvedValue(prepared());
    try {
      if (condition === "missing") await rm(join(f.dir, "ME.md"));
      if (condition === "oversized") await writeFile(join(f.dir, "ME.md"), "private ".repeat(5000));
      if (condition === "credential")
        await writeFile(join(f.dir, "ME.md"), "Owner context\npassword is synthetic-secret");
      await f.startSession();
      const event = userEvent("question");
      const result = (await f.hooks.get("before_agent_start")!(event, f.ctx)) as {
        message: { content: string };
      };
      expect(result.message.content).toContain("memory-context:ready");
      expect(run).toHaveBeenCalledOnce();
      const profile = event.systemPromptOptions.sections["owner-profile"];
      expect(profile).not.toContain("synthetic-secret");
      if (condition === "credential") expect(profile).toContain("[REDACTED:credential]");
      else expect(profile).toBe("");
    } finally {
      await f.close();
    }
  },
);

test("the bounded recall failure remains explicit and does not remove the loaded profile snapshot", async () => {
  const f = await fixture();
  run.mockImplementation(() => new Promise<PreparedRecall>(() => {}));
  try {
    await f.startSession();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    const event = userEvent("will timeout");
    const result = (await f.hooks.get("before_agent_start")!(event, f.ctx)) as {
      message: { content: string };
    };
    expect(run).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(result.message.content).toContain("memory-context:unavailable");
    expect(event.systemPromptOptions.sections["owner-profile"]).toContain("Initial owner profile");
  } finally {
    await f.close();
  }
});

test("switch cancellation discards late recall completion without changing the session snapshot", async () => {
  const f = await fixture();
  let finish!: (value: PreparedRecall) => void;
  run.mockImplementation(
    () =>
      new Promise<PreparedRecall>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await f.startSession();
    const event = userEvent("question");
    const pending = f.hooks.get("before_agent_start")!(event, f.ctx) as Promise<unknown>;
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await f.hooks.get("session_before_switch")!({}, f.ctx);
    finish(prepared());
    await expect(pending).resolves.toBeUndefined();
    expect(event.systemPromptOptions.sections["owner-profile"]).toContain("Initial owner profile");
  } finally {
    await f.close();
  }
});
