import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DreamDependencies } from "../dream-runtime.ts";
import { executeDream } from "../dream-executor.ts";

const run = vi.hoisted(() =>
  vi.fn<(deps: DreamDependencies, signal: AbortSignal) => Promise<string>>(),
);
vi.mock("../dream-runtime.ts", () => ({ runDream: run }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  run.mockReset();
});
function harness() {
  vi.stubEnv("AGENT_ROLE", "pm");
  const complete = vi.fn().mockResolvedValue({
    stopReason: "stop",
    content: [{ type: "text", text: "private reflection" }],
    usage: { totalTokens: 7 },
  });
  const ctx = {
    model: { provider: "other", id: "conversation" },
    modelRegistry: {
      find: (p: string, m: string) =>
        p === "p" && m === "dream" ? { provider: p, id: m } : undefined,
      complete,
    },
  } as unknown as ExtensionContext;
  return {
    ctx,
    complete,
    options: {
      model: "p/dream",
      shutdown: new AbortController().signal,
      onUsage: vi.fn(async () => {}),
    },
  };
}
test("executes with the configured model and fresh tool-free messages, discarding reflection", async () => {
  const h = harness();
  run.mockImplementation((deps, signal) =>
    deps.complete("dream system", "private evidence", signal),
  );
  expect(await executeDream(h.ctx, h.options)).toBeUndefined();
  expect(h.complete.mock.calls[0][0]).toEqual({ provider: "p", id: "dream" });
  expect(h.complete.mock.calls[0][1]).toMatchObject({
    systemPrompt: "dream system",
    messages: [{ role: "user", content: "private evidence" }],
  });
  expect(h.complete.mock.calls[0][1]).not.toHaveProperty("tools");
  expect(h.ctx.model?.id).toBe("conversation");
  expect(h.options.onUsage).toHaveBeenCalledWith({ totalTokens: 7 });
});
test.each(["fuzzy", "p/missing", "p/dream extra"])(
  "refuses invalid or unavailable model %s before memory access",
  async (model) => {
    const h = harness();
    await expect(executeDream(h.ctx, { ...h.options, model })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  },
);
