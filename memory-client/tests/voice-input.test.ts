import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    callTool = callTool;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));

const { transcribeTelegramVoice } = await import("../voice-input.ts");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "voice-input-"));
  callTool.mockReset();
  callTool.mockResolvedValue({
    isError: false,
    structuredContent: { transcript: "hello from voice" },
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("transcribeTelegramVoice", () => {
  it("returns undefined when the prompt has no audio attachment", async () => {
    const text = `[telegram] from owner\n\n[attachments] ${dir}\n- /photo-1.jpg`;
    await expect(transcribeTelegramVoice(text)).resolves.toBeUndefined();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("replaces a same-directory voice attachment with the transcript", async () => {
    await writeFile(join(dir, "voice-4242.ogg"), Buffer.from("audio"));
    const text = `[telegram] from owner\n\n[attachments] ${dir}\n- /voice-4242.ogg\n\n[time] now`;
    await expect(transcribeTelegramVoice(text)).resolves.toBe(
      "[telegram] from owner\n\nhello from voice\n\n[time] now",
    );
    expect(callTool).toHaveBeenCalledWith(
      { name: "transcribe_audio", arguments: { audio: Buffer.from("audio").toString("base64") } },
      undefined,
      expect.anything(),
    );
  });

  it("keeps non-audio attachments and transcribes each audio file", async () => {
    await writeFile(join(dir, "audio-1.mp3"), Buffer.from("a"));
    await writeFile(join(dir, "voice-2.ogg"), Buffer.from("b"));
    const text = `caption\n\n[attachments] ${dir}\n- /photo-0.jpg\n- /audio-1.mp3\n- /voice-2.ogg`;
    const result = await transcribeTelegramVoice(text);
    expect(result).toBe(
      `caption\n\nhello from voice\nhello from voice\n[attachments] ${dir}\n- /photo-0.jpg`,
    );
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("reads absolute attachment paths when files come from different directories", async () => {
    const file = join(dir, "voice-9.ogg");
    await writeFile(file, Buffer.from("x"));
    const text = `[attachments]\n- ${file}`;
    await expect(transcribeTelegramVoice(text)).resolves.toBe("hello from voice");
  });

  it.each([
    [
      "speech tool error",
      () => callTool.mockResolvedValue({ isError: true, content: [] }),
      "speech service could not transcribe it",
    ],
    [
      "empty transcript",
      () => callTool.mockResolvedValue({ isError: false, structuredContent: { transcript: "  " } }),
      "no speech was detected",
    ],
    [
      "speech connection failure",
      () => callTool.mockRejectedValue(new Error("ECONNREFUSED")),
      "speech service could not transcribe it",
    ],
  ])("explains %s without inventing text", async (_name, arrange, reason) => {
    arrange();
    await writeFile(join(dir, "voice-1.ogg"), Buffer.from("audio"));
    const text = `[attachments] ${dir}\n- /voice-1.ogg`;
    await expect(transcribeTelegramVoice(text)).resolves.toBe(
      `[voice message could not be transcribed: ${reason}]`,
    );
  });

  it("does not send audio larger than the 10 MB speech limit", async () => {
    await writeFile(join(dir, "voice-big.ogg"), Buffer.alloc(10_000_001));
    const text = `[attachments] ${dir}\n- /voice-big.ogg`;
    await expect(transcribeTelegramVoice(text)).resolves.toBe(
      "[voice message could not be transcribed: audio is larger than 10 MB]",
    );
    expect(callTool).not.toHaveBeenCalled();
  });

  it("reports an unreadable audio file", async () => {
    const text = `[attachments] ${dir}\n- /voice-missing.ogg`;
    await expect(transcribeTelegramVoice(text)).resolves.toBe(
      "[voice message could not be transcribed: audio file could not be read]",
    );
  });
});
