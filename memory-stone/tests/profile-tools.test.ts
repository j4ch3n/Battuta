import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { OwnerProfile } from "../profile/storage.ts";
import { registerProfileTools } from "../profile/tools.ts";

const document = "# About Human Product Owner\n\n## Background and role\n\nEnjoys hiking.\n";
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "profile-tools-"));
  const profile = new OwnerProfile(directory);
  const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const complete = vi
    .fn<
      (...args: Parameters<ExtensionToolContext["modelRegistry"]["complete"]>) => Promise<unknown>
    >()
    .mockResolvedValue({
      content: [{ type: "text", text: document }],
      stopReason: "stop",
      usage: { totalTokens: 123 },
    });
  const ctx = {
    model: { id: "configured" },
    modelRegistry: { complete },
  } as unknown as ExtensionToolContext;
  registerProfileTools(
    {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
        tools.set(tool.name, tool),
    } as unknown as ExtensionAPI,
    profile,
  );
  return {
    profile,
    complete,
    ctx,
    read: () => tools.get("profile_read")!.execute("read", {}, undefined, undefined, ctx),
    update: (params: object, signal?: AbortSignal) =>
      tools.get("profile_update")!.execute("call", params, signal, undefined, ctx),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
const params = {
  message: "I love hiking",
  interpretation: "Confirmed enduring interest",
  operation: "remember",
  expectedRevision: "missing",
};

test("separate completion gets full profile and labelled evidence without tools; usage is reported", async () => {
  const f = await fixture();
  try {
    const previous = await f.profile.write(document + "Unrelated confirmed fact.\n", "missing");
    const result = await f.update({ ...params, expectedRevision: previous.revision });
    expect(result.details).toMatchObject({ updated: true });
    const [model, context] = f.complete.mock.calls[0];
    expect(model).toEqual(f.ctx.model);
    expect(context.systemPrompt).toMatch(/preserve/i);
    expect(context.systemPrompt).not.toMatch(
      /SQLite|transcripts|backups|detailed personal memory|project memory/i,
    );
    expect(context.tools).toBeUndefined();
    expect(typeof context.messages[0].content).toBe("string");
    const evidence = JSON.parse(context.messages[0].content as string) as {
      existingDocument: string;
    };
    expect(evidence.existingDocument).toBe(previous.content);
    expect(JSON.stringify(context.messages)).toContain("interpretation");
    expect(result.details).toMatchObject({
      updated: true,
      store: "ME.md",
      usage: { totalTokens: 123 },
    });
  } finally {
    await f.cleanup();
  }
});

test("first update supplies skill template without inventing initial owner facts", async () => {
  const f = await fixture();
  try {
    expect((await f.update(params)).details).toMatchObject({ updated: true });
    expect(JSON.stringify(f.complete.mock.calls[0][1])).toContain("# About Human Product Owner");
    expect((await f.profile.read()).content).toBe(document);
  } finally {
    await f.cleanup();
  }
});

test.each(["generation", "refresh"])(
  "%s embeds the canonical template in the system prompt while retaining the full existing profile",
  async (mode) => {
    const f = await fixture();
    try {
      const template = await readFile(
        new URL("../../shared-skills/memory/references/ME.template.md", import.meta.url),
        "utf8",
      );
      const legacyDocument =
        "# About Human Product Owner\n\n## Old interests\n\nEnjoys hiking.\n\n## Background\n\nFounder.\n";
      const current =
        mode === "refresh"
          ? await f.profile.write(legacyDocument, "missing")
          : await f.profile.read();
      expect(
        (await f.update({ ...params, expectedRevision: current.revision })).details,
      ).toMatchObject({
        updated: true,
      });
      const context = f.complete.mock.calls[0][1];
      expect(context.systemPrompt).toContain(template);
      const evidence = JSON.parse(context.messages[0].content as string) as {
        existingDocument: string;
      };
      expect(evidence.existingDocument).toBe(mode === "refresh" ? legacyDocument : template);
    } finally {
      await f.cleanup();
    }
  },
);

test.each([
  "no model",
  "provider error",
  "invalid output",
  "aborted",
  "revision conflict",
  "credential",
  "output credential",
  "incomplete completion",
  "abort during completion",
])("%s leaves existing profile unchanged", async (failure) => {
  const f = await fixture();
  try {
    const original = await f.profile.write(document, "missing");
    const input = { ...params, expectedRevision: original.revision };
    if (failure === "no model") f.ctx.model = undefined;
    if (failure === "provider error") f.complete.mockRejectedValue(new Error("provider down"));
    if (failure === "invalid output")
      f.complete.mockResolvedValue({
        content: [{ type: "text", text: "no heading" }],
        stopReason: "stop",
      });
    if (failure === "revision conflict") input.expectedRevision = "missing";
    if (failure === "credential") input.message = "Remember my password: secret123";
    if (failure === "output credential")
      f.complete.mockResolvedValue({
        content: [{ type: "text", text: document + "password: secret123" }],
        stopReason: "stop",
      });
    if (failure === "incomplete completion")
      f.complete.mockResolvedValue({
        content: [{ type: "text", text: document }],
        stopReason: "length",
      });
    const controller = new AbortController();
    if (failure === "abort during completion")
      f.complete.mockImplementation(() => {
        controller.abort();
        return Promise.resolve({ content: [{ type: "text", text: document }], stopReason: "stop" });
      });
    const result = await f.update(
      input,
      failure === "aborted" ? AbortSignal.abort() : controller.signal,
    );
    expect(result.details).toMatchObject({ error: true });
    expect(await f.profile.read()).toEqual(original);
  } finally {
    await f.cleanup();
  }
});

test("profile_read reports missing state without creating it and returns the full saved revision", async () => {
  const f = await fixture();
  try {
    expect((await f.read()).details).toMatchObject({
      exists: false,
      revision: "missing",
      content: "",
    });
    expect((await f.profile.read()).exists).toBe(false);
    const saved = await f.profile.write(document, "missing");
    expect((await f.read()).details).toEqual(saved);
  } finally {
    await f.cleanup();
  }
});

test("manual edit during completion wins over stale model output", async () => {
  const f = await fixture();
  try {
    f.complete.mockImplementation(async () => {
      await f.profile.write(document + "New owner fact.\n", "missing");
      return { content: [{ type: "text", text: document }], stopReason: "stop" };
    });
    expect((await f.update(params)).details).toMatchObject({ error: true });
    expect((await f.profile.read()).content).toContain("New owner fact");
  } finally {
    await f.cleanup();
  }
});

test.each(["message", "interpretation", "existing document", "completion output"])(
  "conversational credentials in %s never reach durable profile storage",
  async (source) => {
    const f = await fixture();
    try {
      const credential = "My password is hunter2";
      const original = await f.profile.write(
        source === "existing document" ? document + credential + "\n" : document,
        "missing",
      );
      const input = { ...params, expectedRevision: original.revision };
      if (source === "message") input.message = credential;
      if (source === "interpretation") input.interpretation = credential;
      let submitted = false;
      f.complete.mockImplementation(() => {
        submitted = true;
        return Promise.resolve({
          content: [{ type: "text", text: document + credential + "\n" }],
          stopReason: "stop",
        });
      });
      const result = await f.update(input);
      expect(result.details).toMatchObject({ error: true });
      expect(await f.profile.read()).toEqual(original);
      expect(submitted).toBe(source === "completion output");
    } finally {
      await f.cleanup();
    }
  },
);
