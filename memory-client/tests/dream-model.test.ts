import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { DreamModelError, dreamCompletion } from "../dream-model.ts";

test("uses the configured Pi model and records usage without a conversation turn", async () => {
  const usage: unknown[] = [];
  const ctx = {
    model: { id: "configured" },
    modelRegistry: {
      complete: (
        model: { id: string },
        input: { systemPrompt: string },
        options: { signal: AbortSignal },
      ) => {
        expect(model.id).toBe("configured");
        expect(input.systemPrompt).toBe("Dream prompt");
        expect(options.signal.aborted).toBe(false);
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "Reflection" }],
          usage: { totalTokens: 10 },
        });
      },
    },
  } as unknown as ExtensionContext;
  expect(
    await dreamCompletion(ctx, (value) => {
      usage.push(value);
    })("Dream prompt", "evidence", new AbortController().signal),
  ).toBe("Reflection");
  expect(usage).toEqual([{ totalTokens: 10 }]);
});

test("cancellation settles even if a provider ignores its abort signal", async () => {
  const ctx = {
    model: {},
    modelRegistry: { complete: () => new Promise(() => {}) },
  } as unknown as ExtensionContext;
  const controller = new AbortController();
  const result = dreamCompletion(ctx)("prompt", "evidence", controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow();
});

test.each(["length", "error", "toolUse"])(
  "rejects incomplete model output (%s)",
  async (stopReason) => {
    const ctx = {
      model: {},
      modelRegistry: {
        complete: () =>
          Promise.resolve({ stopReason, content: [{ type: "text", text: "partial" }] }),
      },
    } as unknown as ExtensionContext;
    await expect(
      dreamCompletion(ctx)("prompt", "evidence", new AbortController().signal),
    ).rejects.toThrow("finish");
  },
);

test("keeps the raw provider message and does not cap output tokens", async () => {
  const complete = vi.fn(() =>
    Promise.resolve({ stopReason: "error", errorMessage: "529 overloaded_error: try later" }),
  );
  const ctx = { model: {}, modelRegistry: { complete } } as unknown as ExtensionContext;
  const error = await dreamCompletion(ctx)("p", "e", new AbortController().signal).catch(
    (e: unknown) => e,
  );
  expect(error).toMatchObject({
    stopReason: "error",
    providerMessage: "529 overloaded_error: try later",
  });
  expect((complete.mock.calls[0] as unknown[])[2]).not.toHaveProperty("maxTokens");
  expect(new DreamModelError("unexpected value", "x").stopReason).toBe("unknown");
});
